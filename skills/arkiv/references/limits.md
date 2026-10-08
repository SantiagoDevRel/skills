# Limits and units

Source rechecked 2026-10-08 against SDK 0.8.1; retained Tiramisu probes are dated separately. SDK validation, an observed response and deployed consensus limits are different evidence.

| Item | Value or procedure | Boundary |
| --- | --- | --- |
| Payload | 128 KiB (131,072 bytes) | SDK `$payload` cell limit; ABI and transaction overhead are additional. |
| Entire transaction bytes | Deployed maximum not verified | Do not substitute the payload bound or an upstream txpool default. Estimate the actual operation and bound uploads. |
| HTTP request bytes | Tiramisu ingress accepted 262,144 bytes and rejected 262,145 in retained 2026-10-07 probes | Provider observation, not consensus. Payload is hex-encoded, roughly doubling bytes before ABI/JSON overhead. The tested no-attribute create ceiling was 130,144 payload bytes; attributes and fee/request fields lower it. Prefer at most about 128,000 payload bytes or chunk, and measure the actual estimate AND signed-send body; this margin is not a universal guarantee. |
| Attribute cells | 32 per operation; 30 user attributes on create | SDK encoding budget: payload/content type consume two create cells; patch set/unset and supplied system cells share the operation budget. |
| User attributes after patch | 32 on the observed Tiramisu engine | Count distinct names in the resulting state: retained names plus new `set` names minus removed `unset` names. `$payload`/`$contentType` are excluded. A 33rd user attribute was rejected with `TooManyAttributes(33,32)`; splitting transactions does not raise this ceiling. |
| Attribute name | 32 ASCII bytes | Recommended lowercase subset, leading letter, no reserved keywords. |
| String attribute | 128 UTF-8 bytes | Bytes, not characters; C0 controls and DEL rejected. Payload has a separate limit. |
| Decimal | 18 fractional decimal places | Prefer exact string input to `dec`; avoid floating-point money. |
| Query page | 1–200 entities | Page size, not total results. Bound complete walks by the application's result budget. |
| Block conversion | SDK uses nominal 2 seconds per block | Positive durations are multiples of two seconds; no precise wall-clock guarantee. |
| Gas per create | Estimate exact calldata with `eth_estimateGas` | Payload, attributes and requested lifetime affect cost. A single small successful estimate cannot establish marginal or maximum gas. |
| RPC rate and cost | Inspect `ratelimit`, `Retry-After`, `Arkiv-Cost`, `Arkiv-Quota-Used-Percent` | Observed headers vary by request/account/provider. Stop on quota exhaustion; do not invent a monthly allowance. |
| Writes per batch | No fixed 1,000-operation SDK ceiling | Gas, encoding size and provider limits still bound a transaction; an empty batch throws. |
| JSON-RPC batch / log result | Retained Tiramisu probes: 50 requests per RPC batch; 20,000 logs per `eth_getLogs` result | Provider observations, not entity-operation limits. Split RPC batches and shrink finite log ranges on capacity errors; never skip a block or advance a failed checkpoint. See `arkiv-indexing` for method-specific errors. |

Reserved names (case-insensitive): `and`, `or`, `not`, `true`, `false`, `startswith`, `exists`, `typeof`, `bool`, `i32`, `u64`, `u256`, `dec`, `bytes32`, `bytes`, `str`, `addr`, `key`. Application names cannot start with `$` or contain `--`; the recommended subset excludes both already.

Preserve the source version and observation time when reporting an operational limit. Confirm ingress/body and transaction ceilings with an operator-backed specification before promising a maximum upload size or event throughput.

Sources: [versioned attribute encoding](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/attributes.ts), [value validation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/values.ts), [query engine](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/engine.ts), [expiration conversion](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/expiry.ts), [access-key documentation](https://docs.arkiv.network/start-here/access-keys/).
