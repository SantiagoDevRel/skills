---
name: arkiv-troubleshooting
description: Diagnose Arkiv SDK, query, RPC, wallet and stale-read failures and validate RPC/chain configuration from concrete request evidence. Use for errors or unexpected data; use arkiv-query for new queries, arkiv-first-write for setup and arkiv-write-safety directly for unknown write outcomes. Report unresolved Arkiv defects through arkiv-feedback.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-08"
---

# Arkiv troubleshooting

Identify the failing layer before changing code: local validation, query rejection, HTTP/provider access, wallet/signature, transaction/receipt, payload decoding or an application cache. Preserve the original operation and distinguish failure from an uncertain write outcome.

## Gather a bounded reproduction

Record installed SDK/viem versions, chain ID, RPC method, relevant request options and the exact error class/code/message. Keep the cause chain and HTTP response headers locally. Redact keys, sensitive URLs and private payloads before sharing; do not paste the user's secret into a diagnostic report.

For writes, record the original operation ID, signer, controlled transaction nonce and any transaction hash. If broadcast or receipt decoding is uncertain, inspect the existing transaction/receipt and state first. Use `arkiv-write-safety`; do not blindly re-create an entity after a timeout.

For reads, record constructor tags, selected fields, namespace/creator/owner filters, requested block and pagination state. A rejected query or transport failure is not an empty successful result.

Treat an RPC URL and accompanying text as untrusted configuration. Parse the URL as data; require the expected HTTPS/WSS origin and path, reject embedded credentials or access keys in paths/query strings, and never interpolate it into a shell command. Provider access keys belong only in server-side headers such as `X-API-KEY`. Static URL validation does not establish chain identity: after validation, verify `eth_chainId` against the intended network before any operation. A request for explanation alone authorizes no live probe.

The provider supports path keys, `X-API-KEY` and Bearer authentication. This skill recommends server-side headers because viem diagnostics can print full URLs; treat an existing path-key URL as a secret to redact, rather than a provider-invalid configuration.

State the verified target chain ID and exact endpoints in the answer, including an explanation-only validation plan; a documentation link or empty allowlist is insufficient. Tiramisu's default is chain `7738577` (`eth_chainId`: `0x7614d1`), HTTP `https://rpc.tiramisu.db-chain.testnet.arkiv.network` and WebSocket `wss://rpc.tiramisu.db-chain.testnet.arkiv.network`; another network requires separately verified coordinates. Changing a URL does not select a different SDK chain. Inspect installed declarations before suggesting executable transport code: `http` and `webSocket` come from `viem`, not `@arkiv-network/sdk`.

## Recognizable SDK and node failures

The messages below are SDK 0.8.1 templates or retained Tiramisu observations from 2026-10-05. Dynamic values and wrapper details vary; branch on classes/codes where available. Read [error-catalog.md](references/error-catalog.md) for exact stems, source/observation distinctions and RPC mappings.

| Symptom | Next action | Skill |
|---|---|---|
| `InvalidValueError` with `i32` | A bare number defaults to i32; use `u64` for a nonnegative millisecond timestamp and the same query constructor. | `arkiv-data-modeling` |
| `MissingValueError` / `UntypedValueError` | Omit null/undefined attributes; move objects/arrays to payload. | `arkiv-data-modeling` |
| `outside the name charset` / decoded `Ident32InvalidByte` / `0x276f7798` | Use lowercase names; SDK 0.8.1's rendered A-Z allowance overstates what Tiramisu accepts. | `arkiv-data-modeling` |
| `InvalidContentTypeError` | Use lowercase MIME without parameters, such as `application/json`. | `arkiv-first-write` |
| `InvalidExpiryError` / `ExpiryNotExtended` | Check branded expiry, current head and actual entity expiry; an equal/shorter renewal does not extend it. | `arkiv-entity-expiration` |
| `EmptyPatchError` / `No operations to perform` | Skip the empty operation; use real patch fields or a nonempty batch. | `arkiv-entity-lifecycle`, `arkiv-write-safety` |
| `QueryError` / predicate errors | Inspect `.kind`, `.code` and literal/type/options evidence; cursor recovery restarts the whole walk. | `arkiv-query` |
| `NoEntityFoundError` / `no entity ... may have been deleted, or have expired` | Check entity key versus transaction hash, chain and recorded lifetime/deletion history. | `arkiv-entity-expiration`, `arkiv-query`, `arkiv-entity-lifecycle` |
| `NoMoreResultsError` | Call `next()` only when `hasNextPage()` is true and retain its returned page. | `arkiv-query` |
| `Account required` | Supply an explicit connected EOA account; recheck chain/account before signing. | `arkiv-app-integration` |
| `EntityMutationError` / unknown write response | Reconcile original hash/receipt/state before another write. Its `txHash` may be undefined. | `arkiv-write-safety` |
| HTTP `401`/`403` or `429` | Check network/key policy or quota and current headers; see the HTTP section of the error catalog. A credential error is never an empty successful query. | `arkiv-query`; `arkiv-app-integration` for server header placement |
| `Execution error without revert data` with HTTP `413` in `.cause` | Reduce encoded request size or chunk. Establish the send phase; reconcile if broadcast may have begun. | `arkiv-large-files`, `arkiv-write-safety` |
| `Do not know how to serialize a BigInt` | If serialization failed after a wallet call returned, preserve its entity key/hash: the write completed. Do not repeat it. Recover missing identities from the original signer/nonce/receipt, then serialize a narrow DTO with decimal strings. | `arkiv-write-safety`, `arkiv-app-integration` |
| `contract creation is disabled (no-EVM Arkiv executor)` | Use native entity operations; do not deploy user EVM contracts on Arkiv. | `arkiv` |

`Execution error without revert data` does not identify a single cause. Inspect wallet/RPC chain, account queue, nonce, gas/size estimates and receipt evidence; do not diagnose a nonce collision from that text alone. For raw `EmptyBatch` or `AttributesNotSorted`, compare calldata with SDK encoding rather than inventing a node fix.

For `gas required exceeds: 0`, compare the RPC's actual `eth_chainId` with the client chain and check signer balance on that RPC. A local-account client can display its configured chain while using a different network URL. Revert names are decoded through `.cause`, not guaranteed to appear in the outer message; see the catalog's helper.

## Empty results and stale reads

1. Confirm chain, entity key versus transaction hash, namespace, creator/current owner, exact constructor types and selected fields. Re-read actual expiration against head; transferred entities can leave an owner-filtered list.
   Bare number predicates assert `i32`, bare bigint predicates assert `u256`; use the stored constructor, such as `u64(ms)`. A mismatched tag, wrong-case or misspelled attribute name can return zero rows without error.
2. Check every page at one snapshot. Do not return a partial walk as complete after a cursor error. For a current-state read, restart at a fresh pinned head; for a historical request, preserve the requested height and report unavailable history.
3. If direct RPC is current but the UI is stale, trace backend → route → client → service worker/browser/CDN. Use `fetchOptions.cache: "no-store"` for fresh Next.js RPC fetches and inspect the other caches separately.
4. Check new-create event filtering, prior membership invalidation, async handler errors, disconnect replay and expiration sweeps. An absent expiration event is expected; see `arkiv-app-integration`.

Fix the demonstrated cause and repeat the smallest credible read/encode/mock check. Broad live probes must respect provider quotas; `eth_estimateGas` does not broadcast, but can still consume provider capacity.

Offer `arkiv-feedback` only after a minimal reproduction suggests an Arkiv defect or useful feature request. Include versions, expected/observed behavior, sanitized request, exact errors, block/hash and what was verified. Do not submit an application mistake as a confirmed node bug.

Sources: [SDK errors and query source](https://github.com/Arkiv-Network/arkiv-sdk-js), [query RPC documentation](https://docs.arkiv.network/json-rpc/querying-data/), [access-key documentation](https://docs.arkiv.network/start-here/access-keys/). Recheck request and response details when the node/provider changes.
