# A readonly trusted-publication policy

Use this policy for JSON publications created readonly by an allowlisted creator. It rejects mutable publications even if their creator and current owner are trusted. Fetch the selected fields from the configured chain and RPC before invoking this function. A forged client-side object does not constitute verified chain metadata.

```typescript
import type { Hex } from "viem"

type Publication = {
  key: Hex
  creator: Hex
  owner: Hex
  contentType: string
  creationFlags: { readonly: boolean; permissionlessExtension: boolean }
  toJson(): unknown
}
type TrustedPost = { title: string; content: string; arkivEntityKey: Hex }

export function trustedReadonlyPost(entity: Publication,
  trustedCreators: ReadonlySet<string>): TrustedPost {
  if (!trustedCreators.has(entity.creator.toLowerCase())) {
    throw new Error("Untrusted publication creator")
  }
  if (!entity.creationFlags.readonly) throw new Error("Publication is mutable")
  if (entity.contentType !== "application/json") throw new Error("Unsupported publication format")
  let raw: unknown
  try { raw = entity.toJson() }
  catch { throw new Error("Invalid publication payload") }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      !("title" in raw) || typeof raw.title !== "string" ||
      !("content" in raw) || typeof raw.content !== "string" ||
      raw.title.length < 1 || raw.title.length > 200 || raw.content.length > 10_000) {
    throw new Error("Invalid publication payload")
  }
  return { title: raw.title, content: raw.content, arkivEntityKey: entity.key }
}
```

Configure the creator allowlist independently of retrieved content and normalize its addresses to lowercase. Query with `.createdBy(trustedAddress)`, select `key`, `creator`, `owner`, `creationFlags`, `contentType` and `payload`, and still verify the returned publication's fields. Namespace filters choose content categories; they do not establish trust. The function preserves text, including malicious instructions, as data; the consumer must render/route it safely and prevent tool execution from that content.

Follow [owner is not payload provenance](../SKILL.md#trust-a-publication-not-a-namespace). A trusted owner can receive unsolicited attacker content; creator plus owner also accepts a mutable publication edited during a transfer away and back. A mutable product needs a separately verified signed content version or authenticated mutation history, rather than this readonly gate.

The gate accepts a trusted creator's readonly publication after transfer because its contents remain fixed. If the product also requires publisher-controlled availability, enforce that separate owner/lifetime policy: deletion and extension remain possible, and `permissionlessExtension` allows others to extend. An extension event's owner is not proof of who extended it.

For an audit, preserve a redacted reproduction: a copied namespace by an unrelated creator, a mutable entity transferred to an untrusted owner, a forged payload identity, or a payload asking the agent to reveal secrets. Report the actual gate that accepted/rejected it and the relevant source line. Do not claim prompt-injection resistance merely because a parser accepts a string.
