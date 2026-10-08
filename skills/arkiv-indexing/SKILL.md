---
name: arkiv-indexing
description: Design and verify Arkiv-to-application entity mirrors from native operation logs, with checkpoints, replay, reorganization recovery and Entity Expiration sweeps. Use for an app or PostgreSQL projection and arkiv-sync compatibility checks. This skill's worked consumer runs Arkiv to app; use the verified arkiv-sync 0.3.0 release for the separate EVM-events-to-Arkiv direction.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: "tiramisu"
  verified: "2026-10-08"
---

# Mirror Arkiv state into an application

## When to use

Use this skill when an application needs a derived current-state projection or deliberately retained historical snapshots of Arkiv entities. Use arkiv-query for a one-off read, arkiv-app-integration for delivery/cache behavior, and arkiv-troubleshooting first for an existing error. Use arkiv-security-trust for creator policy and application authorization.

The examples target SDK 0.8.1 and Tiramisu. Building a local projection does not authorize deleting source entities, dropping user tables, deploying a worker or retaining private application data. Keep the indexer's projection ownership and retention policy explicit.

## Compatibility gate: arkiv-sync

Published **arkiv-sync 0.3.0** depends on SDK **0.8.1** and viem **`^2.57.3`**. Strict npm installation, public API typechecks and the `create-arkiv-sync@0.3.0` default scaffold passed with those versions. Funded Tiramisu tests used the same compiled sync module. Before running a worker or funded `quickCheck`, configure source inputs, a locally held authorized signer, sink network and spend budget.

This package reads **EVM contract events into Arkiv**. Its public entries include `EvmSource`, `createIndexer`, `ArkivSink` and `createArkivReader`. The custom consumer below reads **Arkiv into an application projection**; installing sync does not turn it into that reverse mirror or provide application authorization.

The historical **0.2.2** archive depended on SDK **`^0.6.8`**, statically imported a chain absent from SDK 0.8.1 and used removed query/mutation APIs. Release 0.3.0 updates chain selection, typed SDK queries, full replacement through set/unset mutations and fresh pinned scans. Those source changes, not an RPC URL or widened dependency declaration alone, resolve the old incompatibility. Do not recommend 0.2.2 for this consumer.

Use the installed `AGENTS.md` and README for configuration, source checkpoints, owner/sync isolation and reorganization recovery. Serialize the signer and preserve a durable caller write journal. `WriteReconciliationRequiredError` stops further writes until the known outcome is reconciled; restart is not evidence that an earlier write failed. Controlled source/reorg fixtures do not prove a natural network reorganization, and the default external ERC20 source has not been certified by those native-event tests.

The 0.3.0 package's archived candidate evidence and some README wording predate publication. They describe that historical execution, not current registry availability. The registry-installed `dist/index.js` SHA256 `180b2346b53d95c5f3e7a363b4e15be627a9d1fabb6375ec8d9b546d1028f90a` matches the archived tested entry. Check the versioned manifest and installed module independently; do not read `publicationVerified: false` in a candidate receipt as proof that the package is unpublished.

## Source contract

- Read the five native operation events from **`0x4400000000000000000000000000000000000044`**, with SDK `ENTITY_EVENTS_ABI`. Filter by that address, not only matching topics. Event names are `EntityCreated`, `EntityPatched`, `ExpiryExtended`, `OwnershipTransferred`, `EntityDeleted`.
- Logs identify entity keys and operation metadata; they contain neither payload nor attributes. A patch log says something changed, not its new content. The owner in an extension event is not necessarily the transaction sender.
- SDK `watchEntityEvents` context has block number, transaction hash and log index. Fetch block hashes and parent hashes separately; its callback context is not a checkpoint hash or proof of canonicality.
- Treat a watcher as a wake-up/invalidation signal. A durable consumer also scans complete bounded block ranges, including blocks with no matching logs, and awaits its own processing queue. Watcher callbacks are not an awaited database commit.
- For replay, preserve block/log order and deduplicate delivery. Use chain identity, block hash, transaction hash and log index in event identities. A transaction may recur after a reorganization, so transaction hash alone is insufficient.
- Scope fetched entities by configured project/type and trusted creator. This locates rows; publishing or privileged use still requires the readonly, signed-version or authenticated-history policy in `arkiv-security-trust`. Ownership changes do not replace original authorship. A derived database does not become an authorization service or proof that payload content is true.

## Choose the mirror's meaning

| Projection | Read and retention policy |
| --- | --- |
| Current-state mirror | Materialize final entity state at a pinned checkpoint block, remove rows absent from that scope, and sweep expired rows. Current app reads expose the checkpoint/lag. |
| Historical mirror | Retain explicitly chosen block-end versions with source block/hash and retention policy. Historical reads require provider-retained data; logs alone cannot reconstruct payload versions. |

Do not label a current `getEntity(key)` read as state at an older event block: SDK lookup reads head. Use a key-filtered query with `.atBlock(block)` for pinned block-end state, or raw historical lookup with its documented numeric block argument. A historical-read failure must not silently fall back to head.

Several mutations in one block can be coalesced into one final row read per touched key for a **block-end mirror**. That does not reconstruct payload/attributes between operations within the block. A created-and-deleted entity may already be absent by the block end.

## Checkpoint workflow

1. Store the chain ID, genesis/reset identity, projection scope/schema version and baseline snapshot. A chain ID alone cannot distinguish a reset. Bootstrap with a complete pinned query before following later blocks.
2. Choose confirmation lag, maximum range/read budget and a rollback journal window as application policies. The audited Tiramisu endpoint rejected JSON-RPC batches above 50 calls and log results above 20,000; these are observed provider limits, not protocol constants. Use bounded batches and adaptive range splitting for recognized capacity errors. Do not describe a fixed depth as irreversible finality.
3. Before continuing, re-fetch the saved checkpoint block header and compare its hash. Fetch the next header, then its complete native logs by `blockHash`; require contiguous numbers and matching parent/hash identity, including empty log results. Recheck the canonical header after staged reads and before committing.
4. Stage the affected row reads at that block, including owner and expiry updates. A read error or unavailable snapshot leaves the checkpoint unchanged.
5. Sweep rows whose expiry is at or before that checkpoint, even when the block has no operation logs. An extension processed before its deadline changes the stored deadline before the sweep.
6. Atomically commit projection changes, replay identities/journal and the checkpoint. In PostgreSQL, use a transaction scoped to this indexer's owned projection. Do not advance the cursor after only the first log or before writes finish.
7. On a hash mismatch, find a verified common ancestor inside the retained journal, roll back only this indexer's derived state, and replay the new canonical blocks. A timeout is not evidence of a reorganization.
8. If no ancestor or historical state is available, stop and rebuild an isolated projection generation from a fresh complete snapshot. A reset or changed genesis/config identity needs a new generation, not replay under the old cursor.

Read [checkpoint-mirror.md](references/checkpoint-mirror.md) for a runnable SDK block reader, configurable pinned row adapter, conservative membership prefilter, retained-journal serialization/restore and ancestor walk. It demonstrates an owned projection; configure transactional persistence, transport timeout and quota budget before running a worker.

## Worked scenario

A marketplace mirror starts from a pinned snapshot, then processes complete blocks. A create adds a row; a patch re-fetches its typed price and payload; a transfer updates current owner while retaining creator. A delete removes the current projection row. An expiry-only block removes due rows without an event. Replaying the same hash inside the retained journal is a no-op; an older block outside that window requires explicit historical verification or a new generation.

If a saved block hash changes, restore this projection to the verified common ancestor, then process the replacement blocks. The local journal restores the prior row and deadline; replacement creates/patches produce the canonical view. A failed snapshot read commits neither rows nor checkpoint.

Controlled regressions cover those transitions, failed reads/canonical rechecks, serialized-journal restart/rollback, corrupt-state rejection and reset identity rejection. They change only state created by the example and do not certify a production storage adapter or a natural network reorganization.

## Expiration, recovery and privacy

- There is **no Entity Expiration event**. A log-only mirror will retain stale live rows unless it sweeps deadlines or reconciles a current snapshot. Permissionless extension can keep an entity alive longer than its owner intended.
- If the consumer was offline beyond provider retention, a current snapshot can rebuild a current-state mirror. It cannot reconstruct missing historical payload versions from operation logs. Report the gap in any historical archive.
- Keep checkpoint integers exact when persisting them; convert bigint to decimal strings in JSON and restore bigint on load. Persist block hashes, not just numbers. Treat unavailable block data as a read failure until a canonical/reset condition is verified.
- A historical mirror or rollback journal may retain data after deletion or expiration. Those operations cannot retract copies already read. Apply the app's explicit access and retention policy; a mirror is not a privacy control or canonical identity/authorization database.
- Rebuilds and rollbacks affect only a projection this consumer owns. Preserve user/source resources. Verify a new generation before retiring an old generation created by the same workflow.

## Failure conditions

| Error or observable condition | Required handling |
| --- | --- |
| `QueryError.kind === 'block'` / query code `-32006` | Preserve the checkpoint. If the requested block exceeds a fresh serving-node head, wait for lag to clear; if unavailable historical state is confirmed, stop/rebuild under the retention policy. No head substitution. |
| `eth_getLogs` capacity error, including `-32602` with `query exceeds max results 20000` or viem `ResponseBodyTooLargeError` | Reduce/split the bounded range; preserve work until every interval succeeds. Use the [bounded replay error classifier](../arkiv-app-integration/references/realtime.md); unrelated invalid parameters remain fatal. |
| `eth_getLogs` range above the serving node's head | Wait for lag to clear, preserving the checkpoint; reducing the range is not proof of completion. |
| JSON-RPC batch HTTP `413` with `batch exceeds 50 calls` | Split into batches of at most 50 and obey the endpoint's current body/quota limits. |
| `eth_getLogs({ blockHash })` code `-32001` / missing block hash | Re-fetch canonical headers and investigate fork/provider views; this method-specific missing-resource error is not query parser code `-32001`. |
| HTTP `429` / `Retry-After` | Defer, preserving pending work and checkpoint. |
| `Checkpoint hash mismatch` | Find a verified ancestor; roll back owned projection state and replay. |
| `Noncontiguous block or parent hash mismatch` | Recheck canonical headers; do not skip missing blocks. |
| `Snapshot block mismatch`, `Log does not belong to the canonical block`, `Canonical log position unavailable`, `Block hash unavailable`, `Canonical header changed during projection read` | Preserve rows/checkpoint, recheck canonical headers and retry only the uncommitted block after the read condition is resolved. |
| `Chain identity changed; start a new projection generation` | Re-bootstrap under the new identity and scope. |
| `Snapshot row belongs to another creator` | Reject the row; review scope/provenance. |
| `Ancestor outside retained projection journal` | Rebuild from a verified baseline; do not invent old state. |
| `Block older than retained journal` | Do not misclassify as a new reorg; verify historical canonicality separately or reject the replay request. |
| `Corrupt projection ...` / `Projection identity/schema mismatch` | Quarantine the state, verify trusted storage/identity and rebuild an owned generation; file corruption is not evidence of a chain reorg. |

If an available tool profile offers read-only entity verification, use it to corroborate an authorized key and state what it checked. No tool is required to implement this SDK consumer.

## Sources

- SDK 0.8.1: [five-event ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/events.ts), [watcher address/context/callback handling](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/watchEntityEvents.ts), [event types](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/events.ts), [head entity lookup](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/getEntity.ts), [pinned query engine](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/engine.ts).
- Current release: [0.3.0 manifest](https://unpkg.com/arkiv-sync@0.3.0/package.json), [public declarations](https://unpkg.com/arkiv-sync@0.3.0/dist/index.d.ts), [compiled module](https://unpkg.com/arkiv-sync@0.3.0/dist/index.js), [scaffolder manifest](https://unpkg.com/create-arkiv-sync@0.3.0/package.json), [immutable consumer/source guide](https://github.com/SantiagoDevRel/arkiv-sync/tree/a43aa53415d5b3f627f74781fc118d1164733b68) and [pre-publication candidate execution evidence](https://unpkg.com/arkiv-sync@0.3.0/docs/current-candidate-evidence.json). Publication is verified separately from the archived candidate execution.
- Historical compatibility gate: [arkiv-sync 0.2.2 manifest](https://unpkg.com/arkiv-sync@0.2.2/package.json), [published module](https://unpkg.com/arkiv-sync@0.2.2/dist/index.js), [SDK 0.8.1 chain exports](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/chains/index.ts). Published source, not a repository assumption, establishes the mismatch.
- Official [query guide](https://docs.arkiv.network/typescript-sdk/querying-data/) and [native operation protocol](https://docs.arkiv.network/json-rpc/mutating-entities/).

Checked 2026-10-08 UTC. The exact worked consumer compiles with strict/noUncheckedIndexedAccess against SDK 0.8.1 and passes controlled native-log/query/restart regressions; those regressions make no live RPC requests, funded writes or user database changes. A separate read-only probe exercised the published EVM source on a two-block Ethereum WETH Transfer range with canonical header rechecks. Archived package evidence documents earlier scoped sink and application readback results.
