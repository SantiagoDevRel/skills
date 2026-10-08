# Scoped fetching and refresh

Use a configured public SDK client from `arkiv-first-write`/`arkiv-app-integration`; keep `X-API-KEY` server-side. `fetchArkivGraph` requires `createdBy` or `ownedBy` even when `project` is set. Setting both intersects their filters. Creator identifies the original creator; owner can change. These filters scope public data and are not application authentication.

The package accepts `limit` 1–5000 (default 500), requests pages of at most 200 and returns `truncated` when more entities exist. It selects payload, attributes and metadata. Use a tighter SDK projection plus `buildGraph` if a caller cannot accept those fields or payload costs. Graph nodes, junction rows and returned entity counts differ because a resolved join entity becomes an edge.

The `project` option specifically filters the `project` attribute. For another namespace name, omit that option and use typed `attributes`, such as `{ app_namespace: str("example_social") }`. Supplying both intentionally intersects both filters.

```typescript
import type { PublicArkivClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { fetchArkivGraph, buildTables, type LinkRule } from "arkiv-graph"
import type { Hex } from "viem"

const links: LinkRule[] = [{ type: "join", entityType: "follow", sourceAttr: "source_key",
  targetAttr: "target_key", directed: true, label: "follows" }]
const typeAttribute = "entity_type"

export async function readSocialGraph(client: Pick<PublicArkivClient, "select" | "getBlockTiming">,
  creator: Hex, project: string) {
  if (!project || new TextEncoder().encode(project).length > 128) {
    throw new Error("Configure a nonempty public project value of at most 128 UTF-8 bytes")
  }
  const result = await fetchArkivGraph({ client, chain: tiramisu, createdBy: creator, project,
    limit: 500, links, typeAttribute, nativeChainId: tiramisu.id,
    explorerUrl: "https://tiramisu.explorer.arkiv.network",
    arkivExplorer: "https://tiramisu.explorer.arkiv.network", external: { enabled: false } })
  const tables = buildTables(result.graph, result.entities,
    { links, typeAttribute, blockTiming: result.blockTiming })
  return { ...result, tables }
}
```

Show `truncated` as a partial result; do not report a complete follow count from it. A result without truncation covers only the selected scope and snapshot. The package uses SDK cursor pagination; restart after an expired cursor. A missing `blockTiming` leaves expiration estimates unavailable. Display an unknown estimate and keep the original `bigint` `expiresAt` for exact decisions.

`fetchArkivGraph` does not expose the query's snapshot block. Its later `blockTiming.currentBlock` is not that snapshot. For block-exact completeness/liveness, use a pinned SDK query and retain `QueryResult.blockNumber`; check an endpoint with `.where(eq("$key", key(k))).atBlock(B)` at the same block. A current `getEntity(k)` answers a different, head-state question and may throw `NoEntityFoundError`. At a verified block `B`, an entity is live only while `B < expiresAt`; absence alone does not establish expiration. Follow [query](../../arkiv-query/SKILL.md) and [Entity Expiration](../../arkiv-entity-expiration/SKILL.md) for historical-read and absence handling.

## Resolve missing endpoints

`createPlaceholders` defaults to true. A key-based join can draw a ghost endpoint; an unresolved business ID produces an `unresolved:...` node. Neither establishes that an endpoint ever existed or expired. If placeholders are disabled, a join without both endpoints stays visible as an isolated entity/junction row. Missing source/target attributes and self-joins also do not collapse into an edge.

If profile and follow creators differ, a creator-scoped fetch can legitimately omit profile endpoints. Fetch the additional approved public scope separately, apply publisher/schema checks, merge by **entity key**, then reuse `buildGraph`/`buildTables` with the same rules. Do not broaden into an unbounded network query to eliminate ghosts. Stable-ID collisions require an explicit conflict policy rather than trusting first-match rendering.

## Refresh and optional mutations

Watch the SDK `EntityCreated`, `EntityPatched`, `ExpiryExtended`, `OwnershipTransferred` and `EntityDeleted` events through `onEvent` or their `onEntityCreated`, `onEntityPatched`, `onExpiryExtended`, `onOwnershipTransferred` and `onEntityDeleted` handlers. Use the replay/error/cleanup pattern in `arkiv-app-integration`. Match entity keys and refetch trusted metadata before updating a scoped projection. New entities require a scoped fetch because event logs do not contain the app's validated payload/attribute schema. Transfers/deletions need removal as well as addition; expiration needs a periodic live sweep because it has no automatic-expiration event.

Use bounded queues, deduplication, checkpointed replay and canonical reorg reconciliation for a persistent mirror. `arkiv-indexing` owns that workflow. `fetchArkivGraph` supplies a one-shot projection; it does not install an event listener, checkpoint or refresh timer.

The core example is read-only. Optional React mutation callbacks require current account/chain/owner/liveness checks and explicit confirmation of the exact entity before deletion. Extension needs a strictly later expiration target; do not retry an uncertain write. Refresh after confirmation through `arkiv-write-safety` and `arkiv-entity-expiration`. No cascade deletion or removal of copies already read is implied.

The React entry and browser layout are separate integration work. Before adding them, read the installed React practices and package consumer guide, respect the application's React/Next versions, and test loading, empty, error, partial, ghost and wallet-rejection states in rendered layouts. A passing core fixture is not a browser or wallet test.
