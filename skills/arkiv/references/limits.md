# Limits and units

Checked through 2026-10-07 against SDK 0.8.1 and bounded Tiramisu probes. SDK validation, an observed response and deployed consensus limits are different evidence.

| Item | Value or procedure | Boundary |
| --- | --- | --- |
| Payload | 128 KiB (131,072 bytes) | SDK `$payload` cell limit; ABI and transaction overhead are additional. |
| Entire transaction bytes | Deployed maximum not verified | Do not substitute the payload bound or an upstream txpool default. Estimate the actual operation and bound uploads. |
| HTTP request bytes | Provider-specific; measure the encoded request | Hex calldata, ABI and JSON add overhead. Retained Tiramisu unsigned estimates with a 131,072-byte payload returned HTTP 413, including a payload-only operation. This does not establish a consensus limit. Choose chunk sizes from accepted exact estimates. |
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

Reserved names (case-insensitive): `and`, `or`, `not`, `true`, `false`, `startswith`, `exists`, `typeof`, `bool`, `i32`, `u64`, `u256`, `dec`, `bytes32`, `bytes`, `str`, `addr`, `key`. Application names cannot start with `$` or contain `--`; the recommended subset excludes both already.

Preserve the source version and observation time when reporting an operational limit. Confirm ingress/body and transaction ceilings with an operator-backed specification before promising a maximum upload size or event throughput.

Sources: [versioned attribute encoding](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/attributes.ts), [value validation](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/values.ts), [query engine](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/engine.ts), [expiration conversion](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/expiry.ts), [access-key documentation](https://docs.arkiv.network/start-here/access-keys/).
