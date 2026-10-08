---
name: arkiv-entity-expiration
description: Choose and verify Arkiv Entity Expiration and Lifetime Extension with @arkiv-network/sdk. Use for ExpirationTime helpers, absolute block deadlines, adding time to an existing entity, renewal races, permanent(), expiration sweeps, and expired or missing entities. Use arkiv-entity-lifecycle for permissions and arkiv-write-safety for uncertain transaction outcomes.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-08"
---

# Arkiv entity expiration

Entity Expiration is a block deadline. Lifetime Extension moves that deadline later; it does not add a duration automatically. Use the installed SDK and Tiramisu, and keep signer permissions separate from deadline calculations.

## Choose the right meaning

- Use this skill for lifetime units, renewal targets, imminent-expiration queries, and deciding whether a missing entity can be renewed.
- Use `arkiv-entity-lifecycle` for readonly/permissionless extension rights and replacement, and `arkiv-write-safety` when a renewal's submission or receipt is uncertain.
- Distinguish **add one hour to the current deadline** from **ensure at least one hour remains from now**. The first adds 1,800 blocks to the observed deadline; the second may need no write.

## Helpers and observed deadlines

| Helper | Meaning |
| --- | --- |
| `fromSeconds`, `fromMinutes`, `fromHours`, `fromDays`, `fromWeeks` | A relative lifetime floor measured from the inclusion block. |
| `fromMonths` / `fromYears` | Exactly 30-day months / 365-day years before conversion to blocks. |
| `fromBlocks(n)` | A positive whole number of blocks. |
| `atBlock(n)` | An absolute block deadline; it must still be live when submitted/applied. |
| `atDate(date)` | A date converted against the SDK's current block and local clock, rounding upward. |
| `atBlock` or `atDate` with `{ atLeast: fromHours(1) }` | An absolute deadline plus a minimum relative lifetime floor. |
| `permanent()` | The maximum u64 deadline, `(1n << 64n) - 1n`; an API value, not a durability promise. |

Relative helpers use a **nominal two seconds per block**. Converted seconds must be positive whole numbers divisible by two: `fromSeconds(3)` fails. Fractional minutes/hours also risk floating-point conversion errors; prefer an explicitly validated integer number of seconds or `fromBlocks(n)` for computed durations. Real block production and local clocks can drift; these helpers do not enforce a wall-clock appointment.

The native operation carries an absolute deadline and a relative floor. The engine takes `max(absoluteDeadline, inclusionBlock + lifetimeFloor)`. A past `atBlock` can be constructed, then fail when the SDK resolves it before sending; a valid target can also become dead before inclusion. `atLeast` supplies a lifetime floor, not a promise the entity will disappear at the chosen date.

`createEntity().expiresAt` and `extendEntity().expiresAt` are decoded from their successful receipt events. Use those observed block values. SDK 0.8.1 create/extend return-value JSDoc describes a lower bound or estimate, but both implementations read the emitted deadline; a pre-inclusion estimate is not the final observed expiration. `executeBatch` returns keys without deadlines; decode its successful receipt as shown below.

## Worked renewal and sweep

These exported functions require a same-network reader and an explicitly connected wallet. They do not send on import. Run renewals only when the user authorized the target and GLM spend.

```typescript
import {
  createPublicClient, createWalletClient, ExpirationTime, MAX_EXPIRES_AT,
  ENTITY_EVENTS_ABI, NoEntityFoundError,
} from "@arkiv-network/sdk"
import { u64 } from "@arkiv-network/sdk/attr"
import { eq, lte } from "@arkiv-network/sdk/query"
import { decodeEventLog, type Address, type Hex, type TransactionReceipt } from "viem"

type Reader = ReturnType<typeof createPublicClient>
type Wallet = ReturnType<typeof createWalletClient>
const ONE_HOUR_BLOCKS = 1800n

async function readLive(reader: Reader, entityKey: Hex) {
  const entity = await reader.getEntity(entityKey).catch((cause: unknown) => {
    if (cause instanceof NoEntityFoundError) {
      throw new Error("No live entity; verify chain/key and creation, deletion or expiration history", { cause })
    }
    throw cause
  })
  const head = await reader.getBlockNumber({ cacheTime: 0 })
  if (entity.expiresAt <= head) throw new Error("Entity is no longer live; recreate it")
  return { entity, head }
}

export async function addOneHour(reader: Reader, wallet: Wallet, entityKey: Hex) {
  const { entity } = await readLive(reader, entityKey)
  if (entity.expiresAt > MAX_EXPIRES_AT - ONE_HOUR_BLOCKS) {
    throw new Error("One-hour extension exceeds the supported deadline range")
  }
  return wallet.extendEntity({
    entityKey,
    expires: ExpirationTime.atBlock(entity.expiresAt + ONE_HOUR_BLOCKS),
  })
}

export async function ensureOneHourRemains(
  reader: Reader, wallet: Wallet, entityKey: Hex,
) {
  const { entity, head } = await readLive(reader, entityKey)
  if (head > MAX_EXPIRES_AT - ONE_HOUR_BLOCKS) {
    throw new Error("Requested lifetime exceeds the supported deadline range")
  }
  const fromNow = head + ONE_HOUR_BLOCKS
  const target = entity.expiresAt > fromNow ? entity.expiresAt : fromNow
  if (target === entity.expiresAt) {
    return { status: "already_sufficient" as const, expiresAt: entity.expiresAt }
  }
  const extended = await wallet.extendEntity({
    entityKey, expires: ExpirationTime.atBlock(target, { atLeast: ExpirationTime.fromHours(1) }),
  })
  return { status: "extended" as const, ...extended }
}

export function dateWithMinimumLife(date: Date) {
  return ExpirationTime.atDate(date, { atLeast: ExpirationTime.fromHours(1) })
}

export async function listExpiring(
  reader: Reader, project: string, trustedCreator: Address, withinBlocks: bigint,
  maxPages = 20,
) {
  if (withinBlocks < 0n) throw new Error("Choose a non-negative block window")
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new Error("Choose a positive page budget")
  const head = await reader.getBlockNumber({ cacheTime: 0 })
  const cutoff = head > MAX_EXPIRES_AT - withinBlocks ? MAX_EXPIRES_AT : head + withinBlocks
  let page = await reader.select({ key: true, expiresAt: true })
    .where(eq("project", project), lte("$expiresAt", u64(cutoff)))
    .createdBy(trustedCreator).atBlock(head).limit(100).fetch()
  if (page.blockNumber !== head) throw new Error("Expiration snapshot block mismatch")
  const entities = [...page.entities]
  let pages = 1
  while (page.hasNextPage()) {
    if (pages >= maxPages) throw new Error("Expiration scan page budget exhausted; narrow the scope")
    page = await page.next()
    if (page.blockNumber !== head) throw new Error("Expiration snapshot block mismatch")
    pages += 1
    entities.push(...page.entities)
  }
  return { atBlock: head, entities }
}

export function batchDeadlines(receipt: TransactionReceipt) {
  if (receipt.status !== "success") throw new Error("Batch receipt did not succeed")
  const deadlines: { entityKey: Hex; expiresAt: bigint }[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== "0x4400000000000000000000000000000000000044") continue
    // The native address emits the five known operation events; malformed logs must fail visibly.
    const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data,
      topics: log.topics as [Hex, ...Hex[]] })
    if (event.eventName === "EntityCreated" || event.eventName === "ExpiryExtended") {
      deadlines.push({ entityKey: event.args.entityKey, expiresAt: event.args.expiresAt })
    }
  }
  return deadlines
}
```

Adding one hour uses the deadline actually read, not `Date.now()` or only the current chain head. It can still race another renewal: if the deadline has changed, re-read and decide whether the original request is already satisfied or should be recomputed. Never automatically add another hour after an ambiguous confirmed transaction.

`ensureOneHourRemains` uses `max(existingDeadline, observedHead + 1800)`, skips equal targets, and adds a relative one-hour floor when it writes, so later inclusion still gives a full hour. It returns the receipt's observed expiration. Reconcile concurrent changes; skip equal targets in the client rather than depending on the node rejecting a no-op renewal. Fetch the batch receipt by its known transaction hash and verify chain/hash identity before calling `batchDeadlines`.

For a periodic heartbeat, renew only below a configured low-water mark and refill to a larger target with submission slack. For example, check every 100 blocks, renew when fewer than 300 remain, and target 1,800 blocks plus an explicitly budgeted delay margin. Calling a minimum-remaining helper every block can otherwise spend gas on nearly every block. Choose thresholds from the application's tolerated outage and transaction delay.

## Expiration monitoring and end of life

- Natural expiration emits no event. Watches cover explicit operations such as Lifetime Extension; use periodic block checks and refresh queries.
- `listExpiring` returns still-queryable entities whose deadlines are approaching in one pinned snapshot. After expiration, those entities no longer appear: maintain prior known deadlines if you need to remove local cache entries or mirror state.
- An entity is live only while `queryBlock < expiresAt`. To inspect its last live state, query at `expiresAt - 1n` if retained; a query at the deadline excludes it. See [pinned query and retention guidance](../arkiv-query/SKILL.md). Put page/read limits around monitoring scans and require each page to keep the same snapshot block.
- An expired entity cannot be revived by extending its old key. Create a new entity, record its new key, and remap references under `arkiv-entity-lifecycle`.
- `NoEntityFoundError` can mean never created, deleted, expired, or the wrong network/key. Check the network, key, and known creation/expiration evidence; the exception alone does not identify the cause.
- To investigate a known key, verify the chain ID, canonical successful creation receipt, and its `EntityCreated` key/deadline. Scan that key's complete canonical `EntityDeleted` / `ExpiryExtended` history from creation through a fresh head in bounded block ranges; shrink capacity-limited ranges, validate block hashes and successful receipts, and stop as unresolved if any range or required history is unavailable. Apply extensions in block/transaction/log order to recover the last deadline. A successful delete explains disappearance; otherwise compare the fresh head with that deadline. If historical state is retained, bracket the transition with reads at the last live block and the deadline (or immediately before/after the delete). Natural expiration has no event. A missing key alone, an incomplete log scan, or a different chain does not establish expiration.
- Expiration removes live queryable state, not copies already read by others. Keep secrets out of plaintext payloads and attributes. With `permissionlessExtension`, a third party may keep a live entity beyond the owner's preferred deadline.

## Leases and recovery

Expiration can bound the lifetime of coordination state; it does not establish unique lock ownership or mutual exclusion. Query-then-create can race, block time can drift, renewal can fail, and readers can hold stale state. For a lease protocol, define the authoritative clock, writer coordination, ownership, fencing/version check, and recovery outside a mere deadline. Reject an expired lease before performing its protected operation.

| Error or condition | Response |
| --- | --- |
| `InvalidExpiryError` | Check units, positive even converted seconds, valid dates, u64 bounds, and a deadline after the observed head. |
| `ExpiryDeadOnArrival` | The target is already dead at application; choose a live target only within the authorized renewal intent. |
| `ExpiryNotExtended` | Re-read; the target is shorter than the current deadline, possibly because another renewal won the race. Skip equal client targets and do not blindly resend. |
| `EntityExpired` / `EntityNotFound` | A longer deadline does not restore a dead entity; investigate the identity and recreate when appropriate. |
| `NotOwner` | Check owner/connected account and whether permissionless extension was enabled at creation. |
| `EntityMutationError` with a hash | Inspect receipt status and `ExpiryExtended` before calculating another target. |

Engine names such as `ExpiryDeadOnArrival` are decoded revert names, not JavaScript exception classes. Inspect wrapped viem revert data/cause, or decode raw revert data with viem `decodeErrorResult` and the [versioned engine error ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts). That ABI is an internal source declaration, not a supported deep import. Preserve the RPC method and code because codes alone are ambiguous. A failure proven to occur in validation or an unsigned estimate is before broadcast. An absent hash or an unchanged nonce does **not** prove no transaction was sent: keep uncertain submissions pending under [write-safety](../arkiv-write-safety/SKILL.md).

## Verification and sources

Verify the receipt's deadline and a fresh entity read after renewal. Treat a subsequent read failure as a verification issue, not proof the renewal failed. Optional connected read-only `verify_entity`/`verify_tx` tools may supplement this; inspect their schema and never pass a signing key.

- [Native expiration and events](https://docs.arkiv.network/json-rpc/mutating-entities/).
- [Entity lifecycle fundamentals](https://docs.arkiv.network/start-here/fundamentals/).
- SDK 0.8.1: [helper implementation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/expirationTime.ts), [expiry resolution](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/expiry.ts), [extension receipt decoding](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/extendEntity.ts), [batch return type](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/executeBatch.ts), [event ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/events.ts).
