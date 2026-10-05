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

`watchEntityEvents` returns a synchronous `() => void` unwatch function. Its `onError` catches synchronous throws, decoding and transport errors; asynchronous handler rejections need their own catch. This small adapter serializes asynchronous handlers but does **not** implement durable replay, deduplication or reorg recovery:

```typescript
import type { PublicArkivClient } from "@arkiv-network/sdk"
import type { EntityEvent } from "@arkiv-network/sdk/types"

export function watchSerially(client: Pick<PublicArkivClient, "watchEntityEvents">,
  fromBlock: bigint, handle: (event: EntityEvent) => Promise<void>,
  report: (error: unknown) => void) {
  let stopped = false
  let tail = Promise.resolve()
  const safeReport = (error: unknown) => { try { report(error) } catch {} }
  const unwatch = client.watchEntityEvents({ fromBlock,
    onEvent: event => {
      tail = tail.then(async () => { if (!stopped) await handle(event) }).catch(safeReport)
    },
    onError: safeReport,
  })
  return () => { stopped = true; unwatch() }
}
```

Bound this adapter's queue in a real app. On handler failure, mark the replica unhealthy and replay/reconcile the failed range before treating later processed events as a contiguous durable checkpoint. Cleanup stops new/queued processing, but cannot cancel a handler already awaiting a request; guard late cache writes with a scope token or abort signal.

## Transport and handoff

- HTTP watchers poll. A WebSocket transport with no replay `fromBlock` can push logs; supplying a bigint `fromBlock` forces viem's polling path. The SDK does not expose a custom `poll` option.
- Use a verified checkpoint at or below head. With raw `eth_getLogs`, pin a finite block range; `eth_subscribe` delivers new logs and does not itself backfill missed history.
- For a push handoff, buffer live logs first, capture a head, replay the checkpoint through that head, then drain the overlapping buffer in block/log order. Deduplicate the overlap and replay gaps after disconnect. A simpler HTTP design can poll bounded ranges from its checkpoint.
- Deduplicate by chain ID, transaction hash and log index within the canonical chain. Retain canonical block hashes with checkpoints and a bounded overlap window. If a hash changes, discard affected checkpoints and derived state, refetch and replay; a dedup set alone cannot recover a reorg.
- Save progress only after successful processing. Distinguish transport liveness, handler success and checkpoint advancement. Restart an expired snapshot/cursor rather than carrying it into the next replay.

## App filtering

The SDK subscription filters the native operation address, not project, creator or entity keys. For a create/new key, fetch the entity and validate namespace, trusted publisher/current ownership and payload before caching it. For patches, extensions, transfers and deletes, invalidate both detail and the previously affected collection. Re-evaluate membership after attribute or owner changes; deleted entities require prior membership to invalidate the old list.

An event's patch notification does not contain the new payload. Fetch current state and check whether the entity now falls outside the scope. Watcher order is suitable for invalidation; current-head reads are not a historical replica of each intermediate state.

Entity Expiration emits no event. Compare cached actual `expiresAt` block numbers with chain head, remove/refetch expired rows and keep a periodic reconciliation path. Use `arkiv-entity-expiration` for renewal and deadline policies.

Source basis: [SDK live-event documentation](https://docs.arkiv.network/typescript-sdk/live-events/), [viem watchEvent](https://viem.sh/docs/actions/public/watchEvent), [viem getLogs](https://viem.sh/docs/actions/public/getLogs).
