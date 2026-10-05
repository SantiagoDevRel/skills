# Server boundary and DTOs

This generic TypeScript seam uses SDK 0.8.1. The caller supplies real authentication, operation authorization, CSRF and rate-limit checks. It exports functions and does not broadcast on import.

```typescript
import type { WalletArkivClient } from "@arkiv-network/sdk"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import type { Hex } from "viem"

export type Post = { title: string; content: string }
export type StoredPost = Post & { arkivEntityKey: Hex; expiresAtBlock: string }

export function parsePost(raw: unknown): Post {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      !("title" in raw) || typeof raw.title !== "string" ||
      !("content" in raw) || typeof raw.content !== "string") {
    throw new Error("Invalid post payload")
  }
  if (raw.title.length < 1 || raw.title.length > 200 || raw.content.length > 10_000) {
    throw new Error("Post exceeds application bounds")
  }
  return { title: raw.title, content: raw.content }
}

export function postDto(entity: { key: Hex; expiresAt: bigint; toJson(): unknown }): StoredPost {
  return { ...parsePost(entity.toJson()), arkivEntityKey: entity.key,
    expiresAtBlock: entity.expiresAt.toString() }
}

async function readBoundedJson(request: Request): Promise<unknown> {
  if (!request.body) throw new Error("Missing JSON body")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > 32_768) throw new Error("JSON body exceeds application byte limit")
      chunks.push(value)
    }
  } finally { await reader.cancel() }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
}

type Actor = { id: string }
type Dependencies = {
  authenticate(request: Request): Promise<Actor | null>
  authorize(actor: Actor, operation: "create_post"): Promise<boolean>
  csrf(request: Request): Promise<boolean>
  allowWrite(actor: Actor): Promise<boolean>
  signer(): Pick<WalletArkivClient, "createEntity">
}

export function createPostEndpoint(deps: Dependencies) {
  return async function POST(request: Request): Promise<Response> {
    const actor = await deps.authenticate(request)
    if (!actor) return new Response("Unauthorized", { status: 401 })
    if (!await deps.authorize(actor, "create_post") || !await deps.csrf(request)) {
      return new Response("Forbidden", { status: 403 })
    }
    if (!await deps.allowWrite(actor)) return new Response("Rate limited", { status: 429 })
    let post: Post
    try { post = parsePost(await readBoundedJson(request)) }
    catch { return new Response("Invalid post", { status: 400 }) }
    const result = await deps.signer().createEntity({
      payload: jsonToPayload(post), contentType: "application/json",
      attributes: { project: "example_posts", entity_type: "post", user_id: actor.id },
      expires: ExpirationTime.fromDays(30),
    })
    return Response.json({ arkivEntityKey: result.entityKey,
      transactionHash: result.txHash, expiresAtBlock: result.expiresAt.toString() })
  }
}
```

The transport and input adapter need separate production checks. Bound session-derived attribute strings to 128 UTF-8 bytes and reject excess rather than truncate an identity. Serialize the signer's writes. Persist an operation ID and reconcile ambiguous outcomes; do not turn a failed response into another create.

`parsePost` discards unknown fields, including a forged `arkivEntityKey`, before attaching chain identity. It does not sanitize HTML: render text safely or use the app's established content sanitizer. Do not feed payload text to an agent as trusted instructions.

For a credentialed **server-only** reader, configure the public client explicitly:

```typescript
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http } from "viem"

export function createServerReader(accessKey: string) {
  if (!accessKey) throw new Error("Missing server access key")
  return createPublicClient({ chain: tiramisu, transport: http(
    tiramisu.rpcUrls.default.http[0], {
      fetchOptions: { headers: { "X-API-KEY": accessKey }, cache: "no-store" },
    },
  ) })
}
```

Expose selected entity fields and validated DTOs through bounded routes. The header key grants provider access; it neither replaces a signer nor funds gas. Avoid raw provider error responses because they may contain credentialed URLs or headers. Route/cache behavior and authentication still need verification in the actual app.
