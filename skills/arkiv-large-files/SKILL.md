---
name: arkiv-large-files
description: Plan storage and verified retrieval of files and images larger than one Arkiv payload. Use for manifest/chunk design, SHA-256 and byte-length verification, partial uploads, coordinated Entity Expiration, PNG/JPEG storage choices, and external-blob pointers. Check arkiv-chunking and arkiv-images compatibility before adopting them; use arkiv-encryption for confidentiality.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-06"
---

# Arkiv large files

Keep searchable metadata in Arkiv attributes and opaque bytes in payloads or an external blob store. Choose based on file size, transaction count, retention, public visibility, and retrieval cost.

## Current package gate

Registry releases verified on 2026-10-06 UTC; pin the tested versions:

| Package | Version | SDK peer | Verified use |
| --- | --- | --- | --- |
| `arkiv-chunking` | 0.1.1 | `>=0.8.1 <0.9` | SDK 0.8.1 uploads, complete downloads and byte/hash verification. |
| `arkiv-images` | 0.1.2 | `>=0.8.1 <0.9` | SDK 0.8.1 inline/chunked PNG/JPEG; depends on chunking 0.1.1. |

A strict npm consumer passed public API typechecks and import checks with SDK 0.8.1 and viem 2.57.3. Funded Tiramisu byte roundtrips used the same compiled modules with SDK 0.8.1 and viem 2.56.3. These checks cover the tested versions, not every release in the peer range.

Historical chunking 0.1.0 and images 0.1.1 required SDK 0.8.0. Do not downgrade the SDK or bypass peers to install them. Read the installed `AGENTS.md` and README before integration; re-check metadata when selecting another release. Registry verification and the earlier packed-candidate execution are separate evidence.

The packages do not provide an upload-resume API, automatic write retries or whole-file atomicity. The caller owns its writer queue, durable journal and ambiguous-write reconciliation.

## Choose a representation

- **One entity:** raw bytes fit the actual encoded transaction budget. SDK 0.8.1 limits the payload cell to 128 KiB; total transaction framing and attributes add bytes. The payload ceiling is not a verified whole-transaction cap. Estimate the exact operation.
- **Manifest and chunks:** every part must be stored as Arkiv entities, with indexed references and controlled expiration. Account for multiple approvals, gas, provider quotas, and reconstruction queries.
- **Hybrid:** put bulk bytes in IPFS, Arweave, R2, or the application's existing blob store; create an Arkiv entity with URI/CID, SHA-256, byte length, media type, and product metadata. Verify the blob independently. Arkiv Entity Expiration does not control external availability or delete the blob.

Store binary bytes directly; base64 uses `4 * ceil(byteLength / 3)` characters, roughly 33% extra before any JSON framing. Query attributes, not file contents or image pixels. Use `arkiv-data-modeling` for queryable fields and `arkiv-encryption` when confidentiality is required.

## Manifest/chunk contract

Define a versioned manifest with trusted publisher/creator scope, full-file digest, byte length, chunk size/count, MIME metadata, and completion state. Each part needs a typed `manifest: key(...)` reference and `seq: u64(...)` index. Read chunks at the manifest's query block, with matching namespace and creator/owner policy; consume every page.

Before returning bytes, require exactly one part for every index, valid bounds, expected per-part lengths, complete total length, and SHA-256 matching an independently trusted digest when authenticity matters. A digest read from the same mutable manifest detects internal consistency; it does not authenticate the publisher. Reject missing, duplicate, expired, corrupt, or incomplete sets; never return a partial file as success.

The root must not remain available while required parts are already expired: choose `rootExpiresAt <= min(requiredPartExpiresAt)`. A shared absolute deadline is the clearest application design; also leave enough blocks for upload completion and the intended reading window. Confirm observed deadlines and keep uploads from continuing after their root becomes unavailable. A block deadline does not guarantee a wall-clock interval or prevent manual deletion.

Published `arkiv-chunking@0.1.1` creates a mutable incomplete manifest, then N readonly chunks sequentially, then a finalization patch: **N+2 independent transactions**. It gives each entity the same relative lifetime at different inclusion blocks, so later chunks outlive the earlier manifest. It does not implement the shared-absolute-deadline design above. It requires at least `max(32, N+3)` lifetime blocks and checks that the manifest remains live before each part and finalization; these checks do not guarantee completion during a slow upload. Its policies are 100,000-byte default chunks, 120,000-byte maximum chunks, 32 MiB files, and at most 4,096 chunks; these are package policies, not network maxima.

## Partial uploads and recovery

- Serialize the account writer and journal every attempted step, confirmed hash, returned key, index, expected digest/length, and observed deadline. Use `arkiv-write-safety` to distinguish pre-submission failure, unknown broadcast, reverted receipt, and confirmed write with failed decoding.
- Stop subsequent writes when a step is uncertain. Reconcile receipts and existing parts before choosing what remains; a missing query result alone cannot prove a write never landed.
- Mark complete only after every required part is confirmed and verified. Multiple transactions cannot roll back together; failed finalization can leave paid-for parts or an incomplete manifest.
- Published packages preserve available manifest keys and observed confirmed hashes on failure. That list can omit a transaction whose result was lost. They provide no automatic retry/resume, cleanup, deduplication, or whole-file atomicity.
- Progress callbacks are observational and not awaited; they are unsuitable for a durable checkpoint. Only a resolved upload promise signals whole-upload success. Treat a custom resumable protocol as caller-owned work requiring its own journal and tests.
- Do not independently transfer, mutate, or renew package-owned subsets; those are unsupported package workflows. Any coordinated application renewal must preserve every required dependency's lifetime and recover partial progress.

## Images

Published `arkiv-images@0.1.2` preserves original static PNG/JPEG bytes. It does not resize, recompress, strip EXIF/GPS, encrypt, or scan for malware. Decide whether the original file and metadata may be public before uploading; filenames are untrusted text.

Its policies are 25 MiB, 40 million pixels, and a 120,000-byte inline threshold. Inline storage uses one readonly image entity and one transaction. Larger images use 100,000-byte chunks, a file manifest, and a final readonly image root: **N+2 entities and N+3 transactions**. The root's `manifest` key differs from the image entity key. Storage requires at least `max(64, transactionCount+32)` lifetime blocks; this is a package admission policy, not a wall-clock promise.

The final image root is younger than its file manifest and can outlive it. A live image root alone does not prove retrievability. Retrieval reports the earlier queried root/manifest deadline, checks byte length, dimensions and SHA-256, and returns no partial image. The root and manifest reads are separate snapshots; chunk pages share the manifest snapshot.

Container inspection is not a complete pixel decode. A browser consumer must decode approved PNG/JPEG bytes before upload and after retrieval, handle decoding errors, render only the allowed raster MIME, and revoke Blob URLs it creates. Serve other fetched files as downloads, and never execute their contents or filenames.

## Worked hybrid pointer

This Node 22+/secure-browser helper prepares an SDK 0.8.1 create descriptor and verifies retrieved bytes locally. It uploads nothing and sends no transaction. First upload the public blob through the application's existing authorized storage flow and verify its retrieval; then submit the descriptor only under the user's write/spend authorization. Supply an explicit origin allowlist; public pointers must not embed temporary signed URLs or provider credentials.

```typescript
import { createWalletClient, ExpirationTime, jsonToPayload } from "@arkiv-network/sdk"
import { bytes32, u64 } from "@arkiv-network/sdk/attr"
import type { Hex } from "viem"

type Create = Parameters<ReturnType<typeof createWalletClient>["createEntity"]>[0]

async function digest(bytes: Uint8Array): Promise<Hex> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))
  return `0x${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("")}`
}

export async function prepareExternalPointer(
  bytes: Uint8Array, uri: string, mediaType: string, expiresAt: bigint,
  approvedOrigins: ReadonlySet<string>,
): Promise<Create> {
  const url = new URL(uri)
  if (url.protocol !== "https:" || !approvedOrigins.has(url.origin)
      || url.username || url.password || url.search || url.hash || uri.length > 2048) {
    throw new Error("Use an approved public HTTPS object URL without credentials or query tokens")
  }
  if (!/^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType)
      || new TextEncoder().encode(mediaType).length > 128) {
    throw new Error("Use a lowercase MIME type without parameters, at most 128 bytes")
  }
  const sha256 = await digest(bytes)
  return {
    payload: jsonToPayload({ uri: url.href }), contentType: "application/json",
    attributes: { project: "blob_pointer_example", storage: "external",
      sha256: bytes32(sha256), size: u64(bytes.length), media_type: mediaType },
    expires: ExpirationTime.atBlock(expiresAt), flags: { readonly: true },
  }
}

export async function verifyExternalBytes(
  bytes: Uint8Array, expectedSha256: Hex, expectedLength: bigint,
) {
  const snapshot = new Uint8Array(bytes)
  if (expectedLength < 0n || !/^0x[0-9a-fA-F]{64}$/.test(expectedSha256)) {
    throw new Error("Provide a trusted SHA-256 and non-negative byte length")
  }
  if (BigInt(snapshot.length) !== expectedLength || await digest(snapshot) !== expectedSha256.toLowerCase()) {
    throw new Error("External bytes failed length or SHA-256 verification")
  }
  return snapshot
}
```

The URI allowlist is an application input, not a general server-fetch security implementation. Retrieval must bound response size, apply the application's fetch/redirect policy, and verify bytes before use. Keep independently trusted publisher/digest information; an external URL or matching hash alone does not authorize content. The HTTPS example can point to an approved IPFS gateway or blob origin; CID-native resolution requires its own explicit retrieval policy.

## Verification and sources

Record actual versions, representation, transaction count/progress, observed deadlines, and byte-for-byte plus hash comparison. Distinguish local helpers, mocked SDK transport, no-funds estimates, and funded network uploads. Re-check peer compatibility before changing the package gate.

- [Published chunking package](https://www.npmjs.com/package/arkiv-chunking/v/0.1.1), [source and consumer guide](https://github.com/SantiagoDevRel/arkiv-chunking/tree/039f94e565ff8aeb7ea1af7aff6b09ac9392c1f6).
- [Published images package](https://www.npmjs.com/package/arkiv-images/v/0.1.2), [source and consumer guide](https://github.com/SantiagoDevRel/arkiv-images/tree/b0a9a7f8767419ecaa2183c063cfbb356099c918).
- Released execution evidence: [chunking](https://unpkg.com/arkiv-chunking@0.1.1/docs/sdk-0.8.1-evidence.json) and [images](https://unpkg.com/arkiv-images@0.1.2/docs/sdk-0.8.1-evidence.json). These record the earlier packed candidates, module hashes, receipt subsets and tested versions.
- [SDK source](https://github.com/Arkiv-Network/arkiv-sdk-js): published 0.8.1 `src/attr/attributes.ts`, `src/utils/expirationTime.ts`, `src/entity/expiry.ts`, and `src/query/queryResult.ts`.
