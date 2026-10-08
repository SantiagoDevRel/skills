---
name: arkiv-encryption
description: Encrypt and decrypt Arkiv entity payloads with the published arkiv-encryption package. Use for payload confidentiality with an independent encryption key; attributes and metadata remain public. Use arkiv-security-trust for policy and HMAC index design. Wallet recovery, access gates and encrypted group sharing require separate implementations.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  arkiv-encryption: "0.1.0"
  network: tiramisu
  verified: "2026-10-08"
---

# Arkiv payload encryption

Use `arkiv-encryption@0.1.0` through its public imports. It has no SDK dependency/peer and requires Node 22+ or browser WebCrypto in a secure context. Read the package's published [consumer guide](https://github.com/SantiagoDevRel/arkiv-encrypted-entities/blob/arkiv-encryption-v0.1.0/AGENTS.md) and installed declarations before integrating; do not copy a crypto implementation into the app.

## Decide custody before publishing

- Generate an independent encryption key and privately back it up before saving ciphertext. Never request it in chat or put it in attributes, URLs, logs or browser public environment variables. Do not use a wallet private key, seed, password or wallet signature as this key.
- `generateKey()` returns 64 hex characters without `0x`. `importKey(raw)` accepts that string or exactly 32 bytes and returns a non-extractable AES-256-GCM `CryptoKey`. Importing is not password derivation; the original string can still exist in JavaScript memory.
- Decide who receives the key, how it is recovered and how old ciphertext stays readable during rotation. The package has no persistence, escrow/recovery, automatic rotation, sharing or revocation.
- Its random 96-bit IVs require a per-key usage budget across all devices: rotate well before 2^32 encryptions under [NIST SP 800-38D, section 8.3](https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38d.pdf). Use an application keyring and public key IDs; do not change the library's envelope format.
- Encryption covers **only payload bytes**. Attributes, owner/creator, entity key, content type, expiration, transaction metadata and length remain public. Do not index a sensitive plaintext value beside its encrypted payload.
- Ciphertext authentication detects tampering/wrong keys. It does not establish publisher identity or bind ciphertext to entity key, network, wallet or attributes: the format has no additional authenticated data, and valid envelopes can be replayed elsewhere. Validate an independently trusted creator, readonly creation and content type before decrypting a trusted publication.

Use `arkiv-security-trust` for publisher/auth/privacy policy and `arkiv-app-integration` for the actual signing/session boundary. Deletion, expiration or key rotation cannot retract plaintext someone already read; do not promise archive permanence or secure erasure.

## API and a local round trip

The v1 format is a random 12-byte IV, ciphertext and a 16-byte tag: `IV || ciphertext || tag`. `CONTENT_TYPE` is `application/vnd.arkiv.encrypted.v1`; there is no embedded version header. The unpadded envelope exposes exact plaintext byte length plus 28 bytes. `MAX_PLAINTEXT_BYTES` is 100,000 **package policy**, not a network maximum.

If length is sensitive, pad within the encrypted application payload to declared size buckets and validate/remove padding after decryption. Keep the padded plaintext within the package limit. Encrypting a larger chunked file is application-owned: each independent envelope stays within that limit, the manifest must declare whether its digest covers ciphertext or plaintext, and chunk counts/sizes remain public. Neither package supplies an authenticated encrypted-file protocol.

Install with the consumer's package manager after checking its versions: `npm install arkiv-encryption@0.1.0`. Use the existing SDK 0.8.1+ for entity operations. This local test does not write an entity or need a wallet, RPC, funds or access key:

```typescript
import { generateKey, importKey, encryptPayload, decryptPayload } from "arkiv-encryption"

export async function localRoundTrip() {
  const key = await importKey(generateKey())
  const original = new TextEncoder().encode("Synthetic local fixture")
  const envelope = await encryptPayload(key, original)
  const recovered = await decryptPayload(key, envelope)
  if (recovered.length !== original.length || recovered.some((byte, i) => byte !== original[i])) {
    throw new Error("Encryption round trip failed")
  }
  return { plaintextBytes: original.length, envelopeBytes: envelope.length }
}
```

This creates an ephemeral key only for the test. A real write needs an approved private backup before losing its non-extractable handle. Do not log the key or plaintext to prove the test worked.

For SDK writes/reads, load [sdk-payload.md](references/sdk-payload.md). Its writer publishes readonly notes and its reader checks creator, readonly creation and MIME before decrypting. Retrieve raw `payload` and chain metadata, then validate the decoded application data. `toJson()` does not decrypt ciphertext. Follow [owner is not payload provenance](../arkiv-security-trust/SKILL.md#trust-a-publication-not-a-namespace); mutable content needs a verified signed content version or authenticated mutation history, including transfers, rather than trusting its current owner.

## Failure and verification

| `EncryptionError.code` | Action |
|---|---|
| `INVALID_KEY` | Configure a separate 32-byte key/64-character hex secret locally; do not invent a password KDF. |
| `INVALID_INPUT` | Check byte/string input and 100,000-byte plaintext policy. |
| `INVALID_ENVELOPE` | Check byte input, v1 MIME/context and envelope size: 28 through 100,028 bytes. |
| `DECRYPTION_FAILED` | Wrong key or tampered bytes; clear old plaintext and return a safe failure. Do not silently try unrelated keys or display a previous note. |
| `CRYPTO_UNAVAILABLE` | Use a supported Node/browser WebCrypto environment; do not fall back to unencrypted publishing. |
| Any other failure | Return a fixed application error; never log or render the raw error object, which may contain plaintext or credentials. |

Verify known-byte round trips, fresh envelopes, wrong keys, tampering, envelope bounds, lost-key behavior and SDK payload read-back. Reject copied or mutable publications before decryption, including unsolicited transfer-in and transfer-away/edit/transfer-back cases. Separate local/mock results from funded network evidence and browser/XSS testing. Validate the decoded schema after decryption; do not log plaintext or attach a parse error that can quote it.

A keyed HMAC equality index is a separate application design, not a library API. It still reveals equality/frequency; exposing the index key permits enumeration of low-entropy values such as emails. Decide normalization, field/project/version domain separation, independent index-key custody and rotation before suggesting it; it does not provide private ranges, prefixes or ordering. Read the [privacy threat model](../arkiv-security-trust/references/privacy.md) for these limits.

Lit-style gates, wallet-derived recovery and encrypted group sharing also need their own implementation and verification. They are not guarantees of this library. Deletion or rotation cannot retract already read copies; historical provider retention is a separate question, not a permanence guarantee.
