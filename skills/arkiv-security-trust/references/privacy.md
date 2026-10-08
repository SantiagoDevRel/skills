# Payload privacy and key custody

Public entities are not a private database. The SDK puts payload/content-type and attributes into entity-operation transaction calldata. A backend access key protects provider access; it cannot make data on the public network confidential. Wallet ownership controls eligible mutations, not read confidentiality.

The published `arkiv-encryption@0.1.0` API is SDK-agnostic and encrypts bytes with AES-256-GCM. It provides `generateKey`, `importKey`, `encryptPayload` and `decryptPayload`, with content type `application/vnd.arkiv.encrypted.v1`. Read its [versioned consumer guide](https://github.com/SantiagoDevRel/arkiv-encrypted-entities/blob/arkiv-encryption-v0.1.0/AGENTS.md) before integrating. Its 100,000-byte plaintext bound is package policy, not the network payload limit.

Keep an independent encryption key, with private backup and an explicit sharing/recovery policy. A wallet's private key, seed, password or wallet signature is not the input to `importKey`. The package imports exactly 32 raw key bytes or a 64-character hex key without `0x`; it is not a password KDF.

The package encrypts only the supplied payload. Public metadata still includes attribute values, owner/creator, entity key, content type, expiration and ciphertext length. Its envelope has no padding: plaintext length equals envelope length minus 28 bytes. It does not bind an envelope to a particular entity/network/publisher with additional authenticated data, so separately validate that context and do not infer authorship from decryption.

Key loss has no built-in recovery; rotation requires retaining old keys for old ciphertext or publishing newly encrypted data. Losing or revoking a key cannot retract plaintext somebody already decrypted. Expiration/deletion cannot retract previously read copies either. Provider retention of historical data is a separate question; do not infer permanent availability from calldata encoding.

## Equality queries over private values

This is an application design, **not an exported arkiv-encryption feature**. A keyed HMAC blind index can support equality checks while storing the actual value in encrypted payloads. Choose normalization, domain separation, field/project/version context and a separate index-key custody policy before implementing it.

Plain unsalted hashes of low-entropy emails or labels can be enumerated. HMAC indexes still reveal equality/frequency and become enumerable if their key is exposed. Do not promise private ranges, prefixes or ordering, and do not copy sensitive values into other cleartext attributes. Index-key rotation changes matching values; plan migration/reconciliation explicitly.

This server-only example uses an independent index key and unambiguous project/version/field framing. The product must choose email normalization; trim/lowercase is only the example's policy. Store `email_idx` and public `email_kid` beside encrypted payload, and retain old index keys privately until migration completes.

```typescript
import { createHmac } from "node:crypto"
import { bytes32, str } from "@arkiv-network/sdk/attr"
import { and, eq, or } from "@arkiv-network/sdk/query"

type IndexKey = { id: string; version: number; secret: Uint8Array }
export function emailIndex(app: string, email: string, slot: IndexKey) {
  if (!app || !slot.id || !Number.isSafeInteger(slot.version) || slot.version < 1 ||
      slot.secret.byteLength < 32) throw new Error("Invalid private index configuration")
  const framed = JSON.stringify([app, slot.version, "email", email.trim().toLowerCase()])
  return bytes32(`0x${createHmac("sha256", slot.secret).update(framed).digest("hex")}`)
}
export function emailLookup(app: string, email: string, retained: readonly IndexKey[]) {
  if (retained.length < 1 || retained.length > 8) throw new Error("Invalid index keyring")
  return or(...retained.map(slot => and(eq("email_kid", str(slot.id)),
    eq("email_idx", emailIndex(app, email, slot)))))
}
```

Keep project/type and trusted-creator scoping outside that OR. Encryptions and blind indexes need separate keys and rotation policies. This index is not authentication, uniqueness, a password hash or protection against equality/linkability leakage; never ship the keyring to the browser.

Access-gating services, wallet-based recovery and encrypted group sharing require their own verified implementation and current service/version checks. They are not provided by the payload-encryption package, and no particular provider version is verified by this skill.

## Retention and publication choice

If a third party must not prolong live query access, do not enable `permissionlessExtension`. Readonly does not prohibit an allowed extension, transfer or deletion; it protects payload/attribute immutability, not secrecy. Decide whether publishing even encrypted metadata is acceptable before writing it.

Sources: [Arkiv mutation calldata](https://docs.arkiv.network/json-rpc/mutating-entities/), [encryption 0.1.0 guide](https://github.com/SantiagoDevRel/arkiv-encrypted-entities/blob/arkiv-encryption-v0.1.0/README.md), [SDK 0.8.1 creation flags](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/flags.ts).
