# Events, replay and cache reconciliation

SDK 0.8.1 exposes these events and handlers:

| Event | Handler | Useful fields beyond context |
|---|---|---|
| `EntityCreated` | `onEntityCreated` | `entityKey`, `owner`, `expiresAt`, `creationFlags` |
| `EntityPatched` | `onEntityPatched` | `entityKey`, `owner` |
| `ExpiryExtended` | `onExpiryExtended` | `entityKey`, `owner`, `expiresAt` |
| `OwnershipTransferred` | `onOwnershipTransferred` | `entityKey`, `previousOwner`, `newOwner` |
| `EntityDeleted` | `onEntityDeleted` | `entityKey`, `owner` |

Every event has `blockNumber: bigint`, `transactionHash` and `logIndex`. Context has neither `blockHash` nor `removed`; fetch canonical hashes separately or use raw logs when those fields are required. `ExpiryExtended.owner` is the owner, not necessarily the extender when permissionless extension is enabled.

`watchEntityEvents` returns a synchronous `() => void` unwatch function. Its `onError` catches synchronous throws, decoding and transport errors; asynchronous handler rejections need their own catch. Use this bounded adapter for live UI invalidation only. It starts at the current head, stops on the first failure and does **not** advance a durable checkpoint:

```typescript
import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { EntityEvent } from "@arkiv-network/sdk/types"

export function watchSerially(client: Pick<PublicArkivClient, "watchEntityEvents">,
  handle: (event: EntityEvent) => Promise<void>, report: (error: unknown) => void,
  options: { maxQueued?: number; pollingInterval?: number } = {}) {
  const { maxQueued = 256, pollingInterval = 1_000 } = options
  if (!Number.isSafeInteger(maxQueued) || maxQueued < 1 ||
      !Number.isSafeInteger(pollingInterval) || pollingInterval < 1) {
    throw new Error("Invalid watcher bounds")
  }
  let stopped = false
  let queued = 0
  let unwatch = () => {}
  let tail = Promise.resolve()
  const safeReport = (error: unknown) => { try { report(error) } catch {} }
  const fail = (error: unknown) => { stopped = true; unwatch(); safeReport(error) }
  unwatch = client.watchEntityEvents({ pollingInterval,
    onEvent: event => {
      if (stopped) return
      if (++queued > maxQueued) { fail(new Error("Watcher queue exceeded; reconcile cache")); return }
      tail = tail.then(async () => {
        try { if (!stopped) await handle(event) }
        finally { queued-- }
      }).catch(fail)
    },
    onError: fail,
  })
  if (stopped) unwatch()
  return () => { stopped = true; unwatch() }
}
```

On failure, mark the cache unhealthy and reconcile before restarting. Cleanup stops new/queued processing, but cannot cancel a handler already awaiting a request; guard late cache writes with a scope token or abort signal. A quiet watcher does not prove continuity. For HTTP replicas, poll the bounded replay below from persisted progress instead of relying on the watcher to backfill.

## Bounded HTTP replay

SDK 0.8.1 delegates `fromBlock` to viem. When `eth_newFilter` is unavailable, the polling fallback requests the whole unprocessed gap with one `eth_getLogs`; a failed request leaves that same gap for the next poll. The audit observed Tiramisu rejecting a gap with about 20,000 logs. That is a provider observation, not a universal block-count limit.

This example bounds each request to at most 1,000 blocks and halves the range on an explicit capacity error. Even one block can exceed a provider limit: then it stops without advancing, and the consumer needs a narrower event/topic filter or another approved provider. Quota, authentication and unknown errors stop immediately. Configure transport `retryCount: 0` so the application controls retry admission.

```typescript
import { ENTITY_EVENTS_ABI } from "@arkiv-network/sdk"
import type { PublicArkivClient } from "@arkiv-network/sdk"
import { decodeEventLog } from "viem"
import type { DecodeEventLogReturnType, GetLogsReturnType, Hex } from "viem"

type Checkpoint = { blockNumber: bigint; blockHash: Hex }
type RawLog = GetLogsReturnType<undefined, undefined, undefined, bigint, bigint>[number]
type EntityEvent = DecodeEventLogReturnType<typeof ENTITY_EVENTS_ABI, undefined, Hex[], Hex, true>
type EntityLogs = (RawLog & EntityEvent)[]
type Range = { fromBlock: bigint; checkpoint: Checkpoint; logs: EntityLogs }
type ReplayReader = Pick<PublicArkivClient, "getBlockNumber" | "getBlock" | "getLogs">
const nativeAddress = "0x4400000000000000000000000000000000000044"

export function isLogCapacityError(error: unknown): boolean {
  let cause = error
  for (let depth = 0; depth < 10 && typeof cause === "object" && cause !== null; depth++) {
    if ("status" in cause && cause.status === 413) return true
    const message = "message" in cause && typeof cause.message === "string" ? cause.message : ""
    if (/too many (?:results|logs)|(?:result|response|log|range).*\blimit\b|response.*too large/i.test(message) &&
        "code" in cause && (cause.code === -32602 || cause.code === -32005 || cause.code === -32004)) return true
    cause = "cause" in cause ? cause.cause : undefined
  }
  return false
}

export async function replayEntityRanges(reader: ReplayReader, saved: Checkpoint,
  applyRange: (range: Range) => Promise<void>,
  options: { chunkBlocks?: bigint; maxRanges?: number; toBlock?: bigint } = {}) {
  const { chunkBlocks = 1_000n, maxRanges = 100 } = options
  if (saved.blockNumber < 0n || chunkBlocks < 1n || chunkBlocks > 1_000n ||
      !Number.isSafeInteger(maxRanges) || maxRanges < 1) throw new Error("Invalid replay bounds")
  const head = await reader.getBlockNumber({ cacheTime: 0 })
  const target = options.toBlock ?? head
  if (target > head || target < saved.blockNumber) throw new Error("Replay target outside available range")
  let checkpoint = { ...saved }
  let span = chunkBlocks
  let ranges = 0
  while (true) {
    const canonical = await reader.getBlock({ blockNumber: checkpoint.blockNumber })
    if (canonical.hash !== checkpoint.blockHash) throw new Error("Checkpoint changed; recover reorg before replay")
    if (checkpoint.blockNumber === target || ranges === maxRanges) {
      return { checkpoint, target, complete: checkpoint.blockNumber === target }
    }
    const fromBlock = checkpoint.blockNumber + 1n
    const toBlock = fromBlock + span - 1n < target ? fromBlock + span - 1n : target
    const end = await reader.getBlock({ blockNumber: toBlock })
    if (!end.hash) throw new Error("Missing canonical range header")
    let logs: EntityLogs
    try {
      // Fetch raw logs: viem's strict getLogs filtering can silently discard malformed events.
      const rawLogs = await reader.getLogs({ address: nativeAddress, fromBlock, toBlock })
      logs = rawLogs.map(log => ({ ...log, ...decodeEventLog({ abi: ENTITY_EVENTS_ABI,
        data: log.data, topics: log.topics, strict: true }) }))
    } catch (error) {
      if (!isLogCapacityError(error) || fromBlock === toBlock) throw error
      span = (toBlock - fromBlock + 1n) / 2n || 1n
      continue
    }
    const unique = new Map<string, EntityLogs[number]>()
    const hashes = new Map<bigint, Hex>([[toBlock, end.hash]])
    for (const log of logs) {
      if (log.address.toLowerCase() !== nativeAddress || log.removed ||
          log.blockNumber === null || log.blockHash === null ||
          log.transactionHash === null || log.logIndex === null ||
          log.blockNumber < fromBlock || log.blockNumber > toBlock) {
        throw new Error("Invalid replay log position")
      }
      if (!hashes.has(log.blockNumber)) {
        const header = await reader.getBlock({ blockNumber: log.blockNumber })
        if (!header.hash) throw new Error("Missing log block header")
        hashes.set(log.blockNumber, header.hash)
      }
      if (hashes.get(log.blockNumber) !== log.blockHash) throw new Error("Noncanonical replay log; preserve checkpoint")
      const id = `${log.blockHash}:${log.transactionHash}:${log.logIndex}`
      const previous = unique.get(id)
      if (previous && (previous.data !== log.data || previous.topics.join() !== log.topics.join())) {
        throw new Error("Conflicting replay log identity")
      }
      unique.set(id, log)
    }
    logs = [...unique.values()].sort((a, b) =>
      a.blockNumber! < b.blockNumber! ? -1 : a.blockNumber! > b.blockNumber! ? 1 : a.logIndex! - b.logIndex!)
    const check = await reader.getBlock({ blockNumber: toBlock })
    if (check.hash !== end.hash) throw new Error("Replay range changed; preserve checkpoint")
    const anchor = await reader.getBlock({ blockNumber: checkpoint.blockNumber })
    if (anchor.hash !== checkpoint.blockHash) throw new Error("Checkpoint changed during replay; preserve progress")
    const next = { blockNumber: toBlock, blockHash: end.hash }
    // Atomically commit derived state AND next, including empty ranges. Throw to retain saved progress.
    await applyRange({ fromBlock, checkpoint: next, logs })
    checkpoint = next
    ranges++
  }
}
```

Verify chain/genesis and projection scope before loading `saved`. `applyRange` must persist state and checkpoint together, or use idempotent event identities with recoverable commits. Reload the durable checkpoint after an error or restart; never restart from a newer in-memory cursor. Run ranges serially and schedule another bounded pass when `complete` is false. Empty ranges still advance progress and trigger expiration reconciliation. Canonical validation adds one header read per distinct block containing logs; budget range/pass sizes for provider quotas. Malformed or unknown native events fail decoding and preserve the checkpoint. Decode/create membership is only a pre-filter; validate fetched authorship before accepting a new entity.

For persistent projections, use [checkpoint-mirror.md](../../arkiv-indexing/references/checkpoint-mirror.md) for canonical hashes, rollback and pinned state reads. Verify the range header inside the consumer's commit boundary too: a reorg after the network check is still possible. The helper detects a changed checkpoint and refuses; it does not invent a common ancestor or replace durable reorg recovery.

## Transport and handoff

- HTTP watchers poll. A WebSocket transport with no replay `fromBlock` can push logs; supplying a bigint `fromBlock` forces viem's polling path. The SDK does not expose a custom `poll` option.
- Use a verified checkpoint at or below head with bounded replay. Do not hand a large saved gap directly to the SDK watcher. `eth_subscribe` delivers new logs and does not itself backfill missed history.
- For a push handoff, buffer live logs first, capture a head, replay the checkpoint through that head, then drain the overlapping buffer in block/log order. Deduplicate the overlap and replay gaps after disconnect. A simpler HTTP design can poll bounded ranges from its checkpoint.
- Deduplicate by chain ID, transaction hash and log index within the canonical chain. Retain canonical block hashes with checkpoints and a bounded overlap window. If a hash changes, discard affected checkpoints and derived state, refetch and replay; a dedup set alone cannot recover a reorg.
- Save progress only after successful processing. Distinguish transport liveness, handler success and checkpoint advancement. Restart an expired snapshot/cursor rather than carrying it into the next replay.

## App filtering

The SDK subscription filters the native operation address, not project, creator or entity keys. For a create/new key, fetch the entity and validate namespace, authenticated authorship and payload before caching it. Current ownership alone cannot establish trust: anyone can transfer attacker content into your wallet without consent. Use the gate in `arkiv-security-trust`; even creator-plus-owner cannot authenticate a mutable entity transferred away and back. For patches, extensions, transfers and deletes, invalidate both detail and the previously affected collection. Re-evaluate membership after attribute or owner changes; deleted entities require prior membership to invalidate the old list.

An event's patch notification does not contain the new payload. Fetch current state and check whether the entity now falls outside the scope. Watcher order is suitable for invalidation; current-head reads are not a historical replica of each intermediate state.

Entity Expiration emits no event. Compare cached actual `expiresAt` block numbers with chain head, remove/refetch expired rows and keep a periodic reconciliation path. Use `arkiv-entity-expiration` for renewal and deadline policies.

Source basis: [SDK live-event documentation](https://docs.arkiv.network/typescript-sdk/live-events/), [viem watchEvent](https://viem.sh/docs/actions/public/watchEvent), [viem getLogs](https://viem.sh/docs/actions/public/getLogs).
