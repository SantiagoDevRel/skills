# Values that look alike

| Values | Meaning and consequence |
| --- | --- |
| Entity key / transaction hash | Both look like 32-byte hex. A key identifies an entity; a hash identifies a transaction that may contain many entity operations. Use returned keys for queries and hashes for receipt reconciliation. Determine absence from the actual query response; do not infer it from the identifier shape. |
| Owner / creator | Owner controls current mutations and changes on transfer. Creator is immutable provenance of initial creation, not the author of every later mutable payload. Scope trusted publishers by creator and validate update policy. |
| Attributes / payload | Attributes are typed indexed values. Payload is opaque bytes with a MIME type. Both are public; payload encryption leaves attributes visible. |
| Block / timestamp | `expiresAt`, `createdAt` and `updatedAt` are blocks. An application `created_at: u64(Date.now())` is milliseconds. Convert intentionally; never compare them as if they share a unit. |
| Access key / gas / signing key | An RPC access key controls request quota; GLM funds transactions; an EOA signing key authorizes them. Neither RPC quota nor wallet connection is an authenticated app session. |
| Entity nonce / transaction nonce | Entity nonce participates in key prediction. Ethereum transaction nonce sequences submissions. One does not reserve the other; predictions need control of all concurrent creates for that creator. |
| SDK / raw RPC | SDK conveniences cover a subset. Filtered count and direct historical `arkiv_getEntity(key, block)` use raw methods; SDK builder queries also support `atBlock`. SDK result-only metadata is not necessarily unfilterable in raw RPC. Match the exact layer's parameter encoding. |
| Creation `flags` / returned `creationFlags` | Use a `flags` object when creating. Returned metadata describes immutable bits; it is not an accepted create parameter or a patchable field. |
| Duration / extension deadline | `fromHours(1)` requests a minimum life from execution. Adding one hour to an existing deadline needs `atBlock(current.expiresAt + 1800n)`, with overflow and concurrency checks. |

Sources: [entity fields](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/entity.ts), [key prediction](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/predictEntityKeys.ts), [raw RPC](https://docs.arkiv.network/json-rpc/querying-data/).
