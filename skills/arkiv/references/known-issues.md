# Versioned errata

Source rechecked **2026-10-08**, SDK **0.8.1**, Tiramisu (**chain ID 7738577**); network observations retain their original dates. Recheck after a package/node update. These are technical observations, not an automated health status.

| Difference | Verified behavior | Action |
| --- | --- | --- |
| Uppercase application names accepted by SDK | Node rejects `entityType`: `outside the name charset`, decoded `Ident32InvalidByte` / `0x276f7798`; SDK's rendered A-Z allowance is misleading | Use reviewed lowercase names in both model and queries. |
| `ne`, `exists`, `hasType` exported by SDK | Node rejects their rendered `!=`, `EXISTS`, `TYPEOF` with -32002 | Use supported predicates. `NOT (a = v)` includes entities without `a`; it is not typed inequality. |
| Pagination at an unpinned head | Cursor can be rejected as belonging to a different query/block/select (-32005) | Pin one block; assign each new page; discard partial results on bounded restart. |
| SDK filtered count | `getEntityCount()` sends no filter and counts chain-wide | Raw method needs `params: [{ query: expression }]`; unknown `filter` was ignored, causing a silent chain-wide count. |
| SDK metadata filter subset | `$createdAt` and `$contentType` are rejected by the builder but accepted by raw query | Use the exact layer's protocol; this does not imply all returned fields are raw-filterable. |
| Create/extend expiry JSDoc | Describes a pre-inclusion lower bound; both implementations return the decoded receipt expiry | Use returned receipt-derived `expiresAt`, then reconcile if another operation changed it. Batch results omit deadlines; decode their canonical events or read entities. |
| Query authentication/quota errors | Invalid access header returns HTTP401; exhausted anonymous cost quota returns HTTP429 | Do not convert either into an empty success or immediately retry a whole walk. Respect provider headers. |

See `arkiv-troubleshooting` for diagnosis and `arkiv-feedback` for sanitized reporting. This list does not establish archival retention, maximum transaction bytes or a working local node.

## Coming from older skills

| Legacy pattern | Current correction and skill |
| --- | --- |
| `i32(Date.now())` or camelCase names | Explicit `u64` timestamps and lowercase snake_case names; `arkiv-data-modeling`. |
| `await page.next()` without assignment | Pin the snapshot and retain the returned page; `arkiv-query`. |
| `fromHours(1)` to add an hour | Target `atBlock(current.expiresAt + 1800n)`; `arkiv-entity-expiration`. |
| Owner as payload authorship | Allowlisted readonly creator or authenticated mutable version/history; `arkiv-security-trust`. |
| Access key in an RPC URL | Prefer server-side `X-API-KEY`; redact existing credentialed URLs; `arkiv-first-write`. |

Sources: [name validation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/names.ts), [expressions](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/expression.ts), [create implementation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/createEntity.ts), [raw query documentation](https://docs.arkiv.network/json-rpc/querying-data/), [issue #14](https://github.com/Arkiv-Network/skills/issues/14), [issue #16](https://github.com/Arkiv-Network/skills/issues/16).
