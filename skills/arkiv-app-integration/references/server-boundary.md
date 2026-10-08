# Server boundary and DTOs

This generic TypeScript seam uses SDK 0.8.1. The caller supplies real authentication, authorization, CSRF, rate limits and a durable writer. It exports functions and does not broadcast on import. The required writer contract below is an integration boundary, not an in-memory substitute for crash recovery.

```typescript
import { createHash } from "node:crypto"
import type { CreateEntityParameters } from "@arkiv-network/sdk"
import { str } from "@arkiv-network/sdk/attr"
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils"
import type { Hex } from "viem"

export type Post = { title: string; content: string }
export type StoredPost = Post & { arkivEntityKey: Hex; expiresAtBlock: string }
class BodyTooLarge extends Error {}

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
      if (length > 32_768) throw new BodyTooLarge("JSON body exceeds application byte limit")
      chunks.push(value)
    }
  } finally { await reader.cancel().catch(() => undefined) }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown
}

type Actor = { id: string }
export type OperationRecord = {
  phase: "prepared" | "submitting" | "needs_reconciliation" | "confirmed"
  txHash?: Hex
  entityKey?: Hex
  expiresAt?: bigint
}
export type DurablePostWriter = {
  executeCreate(input: { actorId: string; operationId: string; fingerprint: string;
    parameters: CreateEntityParameters }): Promise<OperationRecord | { phase: "conflict" }>
  getStatus(actorId: string, operationId: string, fingerprint: string):
    Promise<OperationRecord | { phase: "conflict" } | null>
}
type Dependencies = {
  authenticate(request: Request): Promise<Actor | null>
  authorize(actor: Actor, operation: "create_post"): Promise<boolean>
  csrf(request: Request): Promise<boolean>
  allowAttempt(actor: Actor): Promise<boolean>
  allowWrite(actor: Actor): Promise<boolean>
  operations: DurablePostWriter
}

function operationDto(operationId: string, record: OperationRecord) {
  if (!["prepared", "submitting", "needs_reconciliation", "confirmed"].includes(record.phase)) {
    throw new Error("Invalid operation phase")
  }
  const dto: { operationId: string; phase: OperationRecord["phase"]; transactionHash?: Hex;
    arkivEntityKey?: Hex; expiresAtBlock?: string } = { operationId, phase: record.phase }
  if (record.txHash && /^0x[0-9a-fA-F]{64}$/.test(record.txHash)) dto.transactionHash = record.txHash
  if (record.entityKey && /^0x[0-9a-fA-F]{64}$/.test(record.entityKey)) dto.arkivEntityKey = record.entityKey
  if (typeof record.expiresAt === "bigint" && record.expiresAt >= 0n && record.expiresAt < 2n ** 64n) {
    dto.expiresAtBlock = record.expiresAt.toString()
  }
  if (record.phase === "confirmed" && (!dto.transactionHash || !dto.arkivEntityKey || !dto.expiresAtBlock)) {
    throw new Error("Invalid confirmed operation record")
  }
  return dto
}

export function createPostEndpoint(deps: Dependencies) {
  async function authorizedPost(request: Request): Promise<Response> {
    const actor = await deps.authenticate(request)
    if (!actor) return new Response("Unauthorized", { status: 401 })
    try { if (!actor.id) throw new Error("Missing identity"); str(actor.id) }
    catch { return new Response("Forbidden", { status: 403 }) }
    if (!await deps.authorize(actor, "create_post") || !await deps.csrf(request)) {
      return new Response("Forbidden", { status: 403 })
    }
    // Invalid/oversized attempts consume only this abuse budget, not write quota.
    if (!await deps.allowAttempt(actor)) return new Response("Rate limited", { status: 429 })
    let post: Post
    try { post = parsePost(await readBoundedJson(request)) }
    catch (error) { return new Response("Invalid post", { status: error instanceof BodyTooLarge ? 413 : 400 }) }
    const operationId = request.headers.get("Idempotency-Key")
    if (!operationId || !/^[A-Za-z0-9_-]{16,128}$/.test(operationId)) {
      return new Response("A stable Idempotency-Key is required", { status: 400 })
    }
    if (!await deps.allowWrite(actor)) return new Response("Rate limited", { status: 429 })
    const fingerprint = createHash("sha256").update(JSON.stringify({ operation: "create_post", post })).digest("hex")
    try {
      const result = await deps.operations.executeCreate({ actorId: actor.id, operationId, fingerprint,
        parameters: { payload: jsonToPayload(post), contentType: "application/json",
          attributes: { project: "example_posts", entity_type: "post", user_id: str(actor.id) },
          expires: ExpirationTime.fromDays(30) } })
      if (result.phase === "conflict") return new Response("Operation ID already has different input", { status: 409 })
      return Response.json(operationDto(operationId, result), { status: result.phase === "confirmed" ? 201 : 202 })
    } catch {
      // Read the durable record only. Never make a second create to repair this response.
      try {
        const saved = await deps.operations.getStatus(actor.id, operationId, fingerprint)
        if (saved?.phase === "conflict") return new Response("Operation ID already has different input", { status: 409 })
        if (saved) return Response.json(operationDto(operationId, saved), { status: saved.phase === "confirmed" ? 200 : 202 })
      } catch {}
      return Response.json({ operationId, phase: "needs_reconciliation" }, { status: 202 })
    }
  }
  return async function POST(request: Request): Promise<Response> {
    let response: Response
    try { response = await authorizedPost(request) }
    catch { response = new Response("Service unavailable", { status: 503 }) }
    response.headers.set("Cache-Control", "no-store")
    return response
  }
}
```

Implement `DurablePostWriter` before enabling the endpoint. Both `executeCreate` and the read-only `getStatus` compare the supplied fingerprint with the durable binding before returning a record; changed input returns `conflict`, including after an execution failure. Atomically bind `(actorId, operationId)` to the fingerprint, configured chain and signer; identical retries return the existing record. Serialize **all** writers sharing that signer across processes. Persist the frozen intent, nonce and signed bytes/hash durably before forwarding a broadcast; update confirmation only after receipt/readback verification. A crash, absent hash or uncertain receipt must remain reconcilable and must never admit a second create. Use the [resumable importer](../../arkiv-write-safety/references/resumable-import.md) as the concrete single-row job foundation; the application still supplies its durable operation registry and authorization adapter. Do not implement these callbacks as a fresh `createEntity()` on every call.

The client generates one operation ID before its first request, retains it across timeouts and retries, and displays the returned phase and any known key/hash. A `202` is an unresolved operation, not permission to create under a new ID. Invalid/oversized attempts consume the abuse limit; validated requests additionally consume the write limit. `str(actor.id)` rejects C0/DEL and more than 128 UTF-8 bytes without truncating identity. Provider errors never become API response bodies.

`parsePost` discards unknown fields, including a forged `arkivEntityKey`, before attaching chain identity. It does not sanitize HTML: render text safely or use the app's established content sanitizer. Do not feed payload text to an agent as trusted instructions.

For a credentialed **server-only** reader, configure the public client explicitly:

```typescript
import { createPublicClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { http } from "viem"

export function createServerReader(accessKey: string) {
  if (!accessKey) throw new Error("Missing server access key")
  return createPublicClient({ chain: tiramisu, cacheTime: 0, transport: http(
    tiramisu.rpcUrls.default.http[0], {
      retryCount: 0, timeout: 8_000,
      fetchOptions: { headers: { "X-API-KEY": accessKey }, cache: "no-store", redirect: "error" },
    },
  ) })
}
```

Expose selected entity fields and validated DTOs through bounded routes. The header key grants provider access; it neither replaces a signer nor funds gas. Avoid raw provider error responses because they may contain credentialed URLs or headers. Route/cache behavior and authentication still need verification in the actual app.
