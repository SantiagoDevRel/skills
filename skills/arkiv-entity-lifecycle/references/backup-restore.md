# Backup and restore

A backup is a snapshot of selected live Arkiv entities, not a copy of all historical transactions. Choose the chain, namespace, trusted creator/owner policy, selection, and block before exporting. Preserve that block if a historical query fails; silently restarting at head changes the backup.

## Capture a consistent snapshot

This server-compatible module captures all pages at one block and returns JSON-safe values. The selection includes payload, typed attributes, flags, owner, creator, and deadline; a keys-only query is insufficient for restoration. The SDK decoder does not validate application JSON, so preserve raw payload bytes and validate them separately before restoring application data.

```typescript
import { createPublicClient } from "@arkiv-network/sdk"
import { eq } from "@arkiv-network/sdk/query"
import { bytesToHex, type Address } from "viem"

type Reader = ReturnType<typeof createPublicClient>

export async function captureSnapshot(
  reader: Reader, project: string, trustedCreator: Address,
) {
  const atBlock = await reader.getBlockNumber({ cacheTime: 0 })
  let page = await reader.select("*")
    .where(eq("project", project)).createdBy(trustedCreator)
    .atBlock(atBlock).limit(100).fetch()
  const entities = [...page.entities]
  while (page.hasNextPage()) {
    page = await page.next()
    entities.push(...page.entities)
  }
  return {
    chainId: reader.chain?.id,
    atBlock: atBlock.toString(),
    entities: entities.map(entity => ({
      oldKey: entity.key, owner: entity.owner, creator: entity.creator,
      createdAt: entity.createdAt.toString(),
      updatedAt: entity.updatedAt.toString(),
      expiresAt: entity.expiresAt.toString(),
      flags: {
        readonly: entity.creationFlags.readonly,
        permissionlessExtension: entity.creationFlags.permissionlessExtension,
      },
      contentType: entity.contentType,
      payloadHex: bytesToHex(entity.payload),
      attributes: Object.entries(entity.attributes).map(([name, typed]) => ({
        name, type: typed.type,
        value: typeof typed.value === "bigint" ? typed.value.toString() : typed.value,
      })),
    })),
  }
}
```

Persist the returned object only after every page succeeds. Keep a manifest with the source network, snapshot block, entity count, payload checksums, format version, and query/trust scope. A snapshot can contain sensitive application data even though the chain data is public; honor the user's chosen destination.

Creator scoping identifies original publishers; transferred mutable content may have been rewritten by its current owner. If the trust policy needs both, apply that policy before treating the snapshot as trusted application content.

## Restore new identities and relationships

1. Validate the complete snapshot and every application's payload schema. Rebuild typed attributes using their stored tags; decimal strings, `u64`/`u256`, addresses, and entity keys must not silently become ordinary strings.
2. Choose authorized signer(s), ownership policy, creation flags, and new deadlines. Original owner/creator/creation block are provenance, not writable system fields. Creates initially belong to the restoring signer; authorized transfers can set the desired owner afterward, but creator remains the restoring signer.
3. Check both budgets: a create carries at most 30 user attributes, while the observed Tiramisu post-patch state ceiling is 32. Restore a mutable 31–32-attribute entity with a create of at most 30 plus a patch of the remaining fields, optionally in one batch using its predicted key. A readonly create cannot be patched later, including within the same batch; preserving readonly and all 31–32 indexed fields is not supported by this route. Reject that plan or agree on a schema with at most 30 attributes and explicitly move selected fields to payload. Preserve provenance in the manifest or payload instead of exceeding either budget.
4. Build an explicit `oldKey → newKey` map from successful create receipts. Keep transaction hashes and progress after each batch. A partial multi-transaction restore is not an atomic restore; reconcile an uncertain batch before continuing or retrying.
5. Rewrite typed `key()` relationships and any documented keys inside validated payloads or application indexes. Do not replace every hex-looking string: transaction hashes, addresses, and opaque application IDs are different values.
6. For a DAG, restore parents before children and use their confirmed keys. For cycles or same-batch readonly relationships, predict every new key under exclusive control of the restoring wallet's entity nonce and reuse the exact salts. Without that control, use stable application IDs or a staged mutable representation agreed with the user.
7. Mutable entities may be patched to remap references after creation. Readonly entities require correct references at creation or another replacement. Splitting a cyclic graph across readonly batches cannot be solved by patching it later.
8. Verify new keys, payload checksums, attribute tags, flags, current owners, actual expiration blocks, and every remapped relationship. Check counts and unique application IDs across all pages, not just the first page or an empty result.
9. After the restored application and references are verified, retire superseded resources you created within the task. Removing an older entity or backup outside that authorized scope requires the user's explicit instruction.

An old deadline may already be past at restore time; choose the new lifetime explicitly rather than submitting a dead deadline or extending it silently. Expired entities cannot be revived under their old keys. References to entities outside the export remain external and require a preservation or replacement policy.

## Plan a wide mutable restore

This helper partitions validated user attributes without dropping their types or values. Use `createAttributes` on the create and `patchAttributes` on a patch of its confirmed or exclusively predicted key. Omit an empty patch. For an atomic restore, creates run before patches in `executeBatch`; keep the original mutable creation flags. Flags cannot be changed later to make a staged mutable entity readonly.

```typescript
import type { AttributeInputs } from "@arkiv-network/sdk"

export function planRestoredAttributes(attributes: AttributeInputs, isReadonly: boolean) {
  const entries = Object.entries(attributes)
  if (entries.length > 32) throw new Error("The restored entity exceeds 32 user attributes")
  if (isReadonly && entries.length > 30) {
    throw new Error("Readonly restoration requires an explicit schema of at most 30 user attributes")
  }
  return {
    createAttributes: Object.fromEntries(entries.slice(0, 30)),
    patchAttributes: Object.fromEntries(entries.slice(30)),
  }
}
```

## Verify the restore

Use a new pinned snapshot after all confirmed writes. Compare application identity and content against the manifest, then traverse the restored relationships with a bounded traversal and a visited-key set. Verify the consuming application reads the new keys; having a correct map in a scratch file is not enough.

Sources: [SDK queries and projections](https://docs.arkiv.network/typescript-sdk/querying-data/), [native operations](https://docs.arkiv.network/json-rpc/mutating-entities/), and SDK 0.8.1 `src/query/{queryBuilder,queryResult,selection}.ts`, `src/attr/{codec,values}.ts`, and `src/actions/public/predictEntityKeys.ts`. Restore policy and application-level provenance are design choices, not additional protocol guarantees.
