---
name: arkiv-entity-lifecycle
description: Create, patch, transfer, replace, or delete Arkiv entities with @arkiv-network/sdk. Use for readonly and permissionlessExtension flags, mutation permissions, ownership versus creator provenance, patch budgets, native batch order, and restoring entity references. Use arkiv-first-write for setup or a first entity, arkiv-entity-expiration for deadlines and arkiv-write-safety for ambiguous submissions.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-08"
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

To add N blocks, target `ExpirationTime.atBlock(current.expiresAt + N)`. `fromHours(1)` means one hour from inclusion, not one additional hour on the current deadline; see `arkiv-entity-expiration`.

For a typo in readonly content, create a corrected entity with a new key and update references. Plan the replacement and verify it before retiring an old entity the user authorized you to remove. Readonly refers to payload and attributes, not the entity's entire lifecycle.

Permissionless extension lets others pay to keep an entity alive. It grants no patch, transfer, or delete permission, and another party can postpone expiration the owner wanted. Neither expiration nor readonly is a privacy control; plaintext data is public.

## Ownership, creator, and patching

- `$owner` is the current owner. `$creator` is the creating wallet and never changes. After transfer, a new owner can rewrite mutable content while the creator still names the original wallet. Creator filtering does not prove who authored the current payload.
- Patch `set` writes only named attributes; `unset` removes named attributes. Omitting payload or content type preserves it; an empty payload explicitly replaces it with empty bytes. Unsetting an absent attribute is allowed.
- Patch cannot change the key, owner, flags, or expiration. Use `changeOwnership` or `extendEntity` for those fields.
- Patch has no compare-and-set condition: concurrent owner writes are last-writer-wins. Only the current owner can patch; use an application writer queue or an explicit conflict policy.
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

export async function publishSnapshot(
  wallet: Wallet, communityRenewal = false, expires: Expiry = ExpirationTime.fromDays(30),
) {
  return wallet.createEntity({
    payload: jsonToPayload({ title: "Published note", body: "Example body" }),
    contentType: "application/json",
    attributes: {
      project: "example_notes", entity_type: "note", created_at: u64(Date.now()),
    },
    expires,
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
  if (!isAddressEqual(old.creator, wallet.account.address)) {
    throw new Error("Only replace a note created by this publisher")
  }
  if (old.contentType !== "application/json") {
    throw new Error("Expected application/json")
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
export async function createRelatedNotes(
  reader: Reader, wallet: Wallet, expires: Expiry = ExpirationTime.fromDays(30),
) {
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
        expires,
      },
      {
        salt: child.salt, payload: jsonToPayload({ title: "Child" }),
        contentType: "application/json",
        attributes: {
          project: "example_notes", entity_type: "child", parent: key(parent.key),
        },
        expires,
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

The replacement accepts only this publisher's readonly JSON notes before parsing. Requiring current ownership is this helper's write policy; the protocol does not require ownership of an old entity to create a new one. Ownership does not authenticate content transferred in from another creator. Adapt the parser to the real schema. The new transaction signs the copied body and attributes under the connected publisher's identity; never republish unauthenticated content under a trusted signer. Repoint application references using the returned `replaces`/`entityKey` mapping and preserve old provenance separately. For other trust policies, use [publication authentication](../arkiv-security-trust/SKILL.md#trust-a-publication-not-a-namespace).

Transfer inspection is a subsequent head read. Later transactions can change ownership or remove the entity before that read. Inspect the confirmed receipt and later operations before retrying; a read failure is not proof transfer failed.

## Atomic batches and new references

`executeBatch` is atomic and the SDK orders operations as creates → patches → deletes → extensions → ownership changes, regardless of object property order. `patchThenDelete` patches first. If that patch fails, the deletion is not applied. Deleting and extending the same key in a batch fails because deletion runs first; split or change the intended operations.

To transfer several authorized entities atomically, use `await wallet.executeBatch({ ownershipChanges: [{ entityKey, newOwner }] })` with one entry per entity. Validate every destination and retain the transaction hash; a recipient does not consent to incoming ownership, and receiving a batch does not authenticate its content.

The related-note example uses the creator's entity-minting nonce, not its transaction nonce. `NO_SALT` resolves to zero salt; it does not bypass nonce-based identity. Reuse the returned salts exactly. Any intervening create from that owner invalidates predictions, even from another application or wallet session. If `predictionsMatch` is false, keep the confirmed transaction hash and actual keys, inspect and repair the child reference; do not resubmit the batch.

Zero salts make keys predictable to anyone who knows the creator and minting nonce. When public predictability is unnecessary, request `count: 2` instead of explicit salts and reuse the returned random salts. For a cycle, predict every key first and place references on both creates; readonly references cannot be patched afterward. Both helpers accept a caller-selected `Expiry` instead of requiring the default 30 days.

Without exclusive custody, use stable application IDs for independently recoverable writes, or create the parent first and use its confirmed key. Namespace and ID filters do not enforce uniqueness.

## End of life and errors

- Delete removes the live entity immediately; Entity Expiration removes it when its deadline is reached. Neither operation retracts copies already read by others. An expired entity cannot be revived: recreate it with a new key and remap references.
- For one authorized entity, use `await wallet.deleteEntity({ entityKey })`; the caller must own it. Keep its transaction hash and reconcile before any retry.
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

The engine names above are decoded revert names, not JavaScript exception classes or guaranteed message fragments. Extract them through the cause chain using [the error catalog](../arkiv-troubleshooting/references/error-catalog.md). A decoded estimate rejection helps correct inputs, but only instrumented proof that send admission was never reached establishes no broadcast. Missing hashes and unchanged nonces alone do not; retain write-safety's reconciliation rule.

## Verification and references

Verify mutation receipts and read back the selected fields. If a connected read-only profile provides `verify_entity` or `verify_tx`, inspect its schema and use it as an additional check; the SDK and explorer remain sufficient, and signing keys stay in the developer's wallet or server.

- [Backup and restore](references/backup-restore.md): pinned snapshots, new identities, relation remapping, and cyclic graphs.
- [Native mutations](https://docs.arkiv.network/json-rpc/mutating-entities/): permissions, flags, batches, events, and exact revert names.
- [Query fields](https://docs.arkiv.network/typescript-sdk/querying-data/): current owner versus immutable creator.
- [SDK 0.8.1 source](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/): `entity/flags.ts`, `actions/wallet/patchEntity.ts`, `attr/attributes.ts`, `utils/arkivTransactions.ts`, and `actions/public/predictEntityKeys.ts`.
