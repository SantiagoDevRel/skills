---
name: arkiv-entity-lifecycle
description: Create, patch, transfer, replace, or delete Arkiv entities with @arkiv-network/sdk. Use for readonly and permissionlessExtension flags, mutation permissions, ownership versus creator provenance, patch budgets, native batch order, and restoring entity references. Use arkiv-entity-expiration for deadline calculations and arkiv-write-safety for ambiguous submissions.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-05"
---

# Arkiv entity lifecycle

Use the installed SDK declarations and Tiramisu behavior. Writes use the native entity operation address `0x4400000000000000000000000000000000000044`; this does not enable user-deployed contracts.

## Choose the operation

- Use this skill for flags, patching, ownership transfer, replacement, deletion, and relationships between new keys.
- Use `arkiv-entity-expiration` for renewal targets and expiration monitoring, `arkiv-write-safety` for signer queues and uncertain receipts, and `arkiv-query` for paginated reads.
- Run the write examples only within the user's authorized scope. A read or estimate does not authorize deleting an existing entity or spending GLM.

## Flags and permissions

Create uses `flags: { readonly, permissionlessExtension }`. Both default to `false` and are immutable: patching, extending, or transferring cannot change them.

| readonly | permissionlessExtension | Patch | Extend | Transfer | Delete |
| --- | --- | --- | --- | --- | --- |
| false | false | Owner | Owner | Owner | Owner |
| false | true | Owner | Anyone | Owner | Owner |
| true | false | Nobody | Owner | Owner | Owner |
| true | true | Nobody | Anyone | Owner | Owner |

These permissions apply to live entities. Choose a later deadline to add lifetime; transfers to the current owner or zero address fail. A previous owner loses owner-only rights after transfer. A readonly entity can still be transferred, extended, or deleted by its owner.

For a typo in readonly content, create a corrected entity with a new key and update references. Plan the replacement and verify it before retiring an old entity the user authorized you to remove. Readonly refers to payload and attributes, not the entity's entire lifecycle.

Permissionless extension lets others pay to keep an entity alive. It grants no patch, transfer, or delete permission, and another party can postpone expiration the owner wanted. Neither expiration nor readonly is a privacy control; plaintext data is public.

## Ownership, creator, and patching

- `$owner` is the current owner. `$creator` is the creating wallet and never changes. After transfer, a new owner can rewrite mutable content while the creator still names the original wallet. Creator filtering does not prove who authored the current payload.
- Patch `set` writes only named attributes; `unset` removes named attributes. Omitting payload or content type preserves it; an empty payload explicitly replaces it with empty bytes. Unsetting an absent attribute is allowed.
- Patch cannot change the key, owner, flags, or expiration. Use `changeOwnership` or `extendEntity` for those fields.
- Each patch has at most 32 mutation cells: distinct `set` names + distinct `unset` names + one for a supplied payload + one for a supplied content type. A name cannot appear in both `set` and `unset`. Create reserves two cells, leaving 30 user attributes. Use snake_case names and lowercase MIME types without parameters.
- Separately, the observed Tiramisu engine caps the resulting entity at **32 user attributes**, excluding payload/content type. Count the union of retained and `set` names after removing `unset` names; replacing an existing name adds no slot. Only a mutable entity can grow from 30 to 31–32 by patching. Splitting writes cannot fit a 33rd attribute; remove an attribute or explicitly revise the payload/schema instead.

## Worked operations

This module exports functions; it performs no writes on import. The caller supplies an explicitly connected wallet and a reader on the same Tiramisu network.

```typescript
import {
  createWalletClient, createPublicClient, ExpirationTime, jsonToPayload,
  NO_SALT, type AttributeInputs, type Expiry,
} from "@arkiv-network/sdk"
import { key, u64 } from "@arkiv-network/sdk/attr"
import { isAddressEqual, zeroAddress, type Address, type Hex } from "viem"

type Wallet = ReturnType<typeof createWalletClient>
type Reader = ReturnType<typeof createPublicClient>

export async function publishSnapshot(wallet: Wallet, communityRenewal = false) {
  return wallet.createEntity({
    payload: jsonToPayload({ title: "Published note", body: "Example body" }),
    contentType: "application/json",
    attributes: {
      project: "example_notes", entity_type: "note", created_at: u64(Date.now()),
    },
    expires: ExpirationTime.fromDays(30),
    flags: { readonly: true, permissionlessExtension: communityRenewal },
  })
}

export async function replaceReadonlyNote(
  reader: Reader, wallet: Wallet, oldKey: Hex, title: string, expires: Expiry,
) {
  const old = await reader.getEntity(oldKey)
  if (!old.creationFlags.readonly) throw new Error("Expected a readonly note")
  if (!wallet.account || !isAddressEqual(wallet.account.address, old.owner)) {
    throw new Error("The connected wallet must own the note")
  }
  const note: unknown = old.toJson()
  if (typeof note !== "object" || note === null ||
      !("body" in note) || typeof note.body !== "string") {
    throw new Error("Invalid note payload")
  }
  const attributes: AttributeInputs = Object.fromEntries(
    Object.entries(old.attributes).map(([name, value]) => {
      if (value.type === "bytes") throw new Error("Unexpected system-only attribute")
      return [name, value] as const
    }),
  )
  if (Object.keys(attributes).length > 30) {
    throw new Error("A readonly replacement must fit 30 user attributes; choose an explicit revised schema")
  }
  const created = await wallet.createEntity({
    payload: jsonToPayload({ title, body: note.body }),
    contentType: "application/json", attributes, expires,
    flags: {
      readonly: true,
      permissionlessExtension: old.creationFlags.permissionlessExtension,
    },
  })
  return { ...created, replaces: oldKey, previousCreator: old.creator }
}

export async function patchDraft(wallet: Wallet, entityKey: Hex) {
  return wallet.patchEntity({
    entityKey,
    set: { status: "published", updated_at: u64(Date.now()) },
    unset: ["draft_reason"],
  })
}

export async function transferAndInspect(
  reader: Reader, wallet: Wallet, entityKey: Hex, newOwner: Address,
) {
  const before = await reader.getEntity(entityKey)
  if (isAddressEqual(newOwner, zeroAddress) || isAddressEqual(newOwner, before.owner)) {
    throw new Error("Choose a different, nonzero owner")
  }
  const transferred = await wallet.changeOwnership({ entityKey, newOwner })
  try {
    const after = await reader.getEntity(entityKey)
    return {
      ...transferred, status: "observed" as const,
      creatorUnchanged: isAddressEqual(before.creator, after.creator),
      ownerAtRead: after.owner, expectedOwnerAtTransfer: newOwner,
    }
  } catch (error) {
    return {
      ...transferred, status: "confirmed_read_failed" as const,
      verificationError: error instanceof Error ? error.name : "UnknownReadError",
    }
  }
}

export async function patchThenDelete(wallet: Wallet, entityKey: Hex) {
  return wallet.executeBatch({
    deletes: [{ entityKey }],
    patches: [{ entityKey, set: { status: "retired" } }],
  })
}

// Precondition: exclusive custody of every create from this wallet until confirmation.
export async function createRelatedNotes(reader: Reader, wallet: Wallet) {
  if (!wallet.account) throw new Error("Connect an account before predicting keys")
  const [parent, child] = await reader.predictEntityKeys({
    owner: wallet.account.address, salts: [NO_SALT, NO_SALT] as const,
  })
  const batch = await wallet.executeBatch({
    creates: [
      {
        salt: parent.salt, payload: jsonToPayload({ title: "Parent" }),
        contentType: "application/json",
        attributes: { project: "example_notes", entity_type: "parent" },
        expires: ExpirationTime.fromDays(30),
      },
      {
        salt: child.salt, payload: jsonToPayload({ title: "Child" }),
        contentType: "application/json",
        attributes: {
          project: "example_notes", entity_type: "child", parent: key(parent.key),
        },
        expires: ExpirationTime.fromDays(30),
      },
    ],
  })
  return {
    ...batch,
    predictionsMatch: batch.createdEntities[0] === parent.key &&
      batch.createdEntities[1] === child.key,
  }
}
```

The replacement preserves the example note's body and attributes. Adapt its parser to the real schema; it deliberately does not copy arbitrary unvalidated JSON. Repoint application references using the returned `replaces`/`entityKey` mapping. A recreated entity's creator and creation block belong to the new write; preserve old provenance separately when needed.

Transfer inspection is a subsequent head read. Later transactions can change ownership or remove the entity before that read. Inspect the confirmed receipt and later operations before retrying; a read failure is not proof transfer failed.

## Atomic batches and new references

`executeBatch` is atomic and the SDK orders operations as creates → patches → deletes → extensions → ownership changes, regardless of object property order. `patchThenDelete` patches first. If that patch fails, the deletion is not applied. Deleting and extending the same key in a batch fails because deletion runs first; split or change the intended operations.

The related-note example uses the creator's entity-minting nonce, not its transaction nonce. `NO_SALT` resolves to zero salt; it does not bypass nonce-based identity. Reuse the returned salts exactly. Any intervening create from that owner invalidates predictions, even from another application or wallet session. If `predictionsMatch` is false, keep the confirmed transaction hash and actual keys, inspect and repair the child reference; do not resubmit the batch.

Without exclusive custody, use stable application IDs for independently recoverable writes, or create the parent first and use its confirmed key. Namespace and ID filters do not enforce uniqueness.

## End of life and errors

- Delete removes the live entity immediately; Entity Expiration removes it when its deadline is reached. Neither operation retracts copies already read by others. An expired entity cannot be revived: recreate it with a new key and remap references.
- Expiration emits no event. Poll or sweep deadlines using `arkiv-entity-expiration`. `NoEntityFoundError` covers never-created, deleted, and expired entities; it does not prove which occurred.

| Error or revert | Action |
| --- | --- |
| `ReadOnlyEntity` | Create a corrected entity and remap references. |
| `NotOwner` | Verify the current owner and connected account. Permissionless extension changes only extension rights. |
| `TransferToSelf` / `TransferToZeroAddress` | Select a different nonzero owner. |
| `EntityNotFound` / `EntityExpired` | Check the key, network, and historical context; a longer target does not revive it. |
| `EmptyPatchError` | Supply at least one mutation or skip the operation. |
| `ConflictingMutationError` | Remove names appearing in both `set` and `unset`. |
| Local SDK `TooManyAttributesError` | Fit each operation within 32 cells, including supplied system cells. Split only when every intermediate and final entity state stays within 32 user attributes. |
| Decoded engine `TooManyAttributes(count,32)` | The resulting entity has too many user attributes. Unset fields or explicitly move them into payload; splitting transactions does not fix this state limit. The decoded revert name need not appear in `error.name` or its message. |
| `EntityMutationError` | Inspect its hash and receipt before retrying; load `arkiv-write-safety`. |

## Verification and references

Verify mutation receipts and read back the selected fields. If a connected read-only profile provides `verify_entity` or `verify_tx`, inspect its schema and use it as an additional check; the SDK and explorer remain sufficient, and signing keys stay in the developer's wallet or server.

- [Backup and restore](references/backup-restore.md): pinned snapshots, new identities, relation remapping, and cyclic graphs.
- [Native mutations](https://docs.arkiv.network/json-rpc/mutating-entities/): permissions, flags, batches, events, and exact revert names.
- [Query fields](https://docs.arkiv.network/typescript-sdk/querying-data/): current owner versus immutable creator.
- [SDK 0.8.1 source](https://github.com/Arkiv-Network/arkiv-sdk-js): `src/entity/flags.ts`, `src/actions/wallet/patchEntity.ts`, `src/attr/attributes.ts`, `src/utils/arkivTransactions.ts`, and `src/actions/public/predictEntityKeys.ts`.
