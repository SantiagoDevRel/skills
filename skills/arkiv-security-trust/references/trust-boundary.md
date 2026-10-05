# A readonly trusted-publication policy

Use this policy only for a feed that requires readonly publication by an allowlisted creator. It deliberately rejects mutable publications; a mutable app needs a different policy. Fetch the selected fields from the configured chain and RPC before invoking this function. A forged client-side object does not constitute verified chain metadata.

```typescript
import type { Hex } from "viem"

type Publication = {
  key: Hex
  creator: Hex
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
  const raw: unknown = entity.toJson()
  if (typeof raw !== "object" || raw === null || Array.isArray(raw) ||
      !("title" in raw) || typeof raw.title !== "string" ||
      !("content" in raw) || typeof raw.content !== "string" ||
      raw.title.length < 1 || raw.title.length > 200 || raw.content.length > 10_000) {
    throw new Error("Invalid publication payload")
  }
  return { title: raw.title, content: raw.content, arkivEntityKey: entity.key }
}
```

Normalize allowlist addresses to lowercase when constructing the set. Query with `.createdBy(trustedAddress)`, select `key`, `creator`, `creationFlags` and `payload`, and still verify the returned publication's fields. Namespace filters choose content categories; they do not establish trust. The function preserves text, including malicious instructions, as data; the consumer must render/route it safely and prevent tool execution from that content.

For mutable entities, the original creator may no longer control the payload after ownership transfer. Validate the current owner's authority or a separately verified content signature. Readonly contents remain fixed across a transfer, but current availability can change through deletion or extension. For permissionless extension, the event's owner is not proof of who extended it.

For an audit, preserve a redacted reproduction: a copied namespace by an unrelated creator, a mutable entity transferred to an untrusted owner, a forged payload identity, or a payload asking the agent to reveal secrets. Report the actual gate that accepted/rejected it and the relevant source line. Do not claim prompt-injection resistance merely because a parser accepts a string.
