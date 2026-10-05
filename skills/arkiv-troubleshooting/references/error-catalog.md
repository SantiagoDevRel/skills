# SDK 0.8.1 error catalog

Messages in quotes below are exact SDK message stems; `<...>` marks a dynamic value, not literal text to match. SDK errors can be wrapped by `EntityMutationError` or viem, so retain their cause chain. Node observations are labeled separately.

| Class or exact stem | Meaning and correction |
|---|---|
| `InvalidValueError`: `Invalid i32 value <input>: <reason>.` | Bare number defaults to i32. Millisecond timestamps need an explicitly chosen larger tag such as u64; `u64` cannot store negatives. Check the actual tag and input. |
| `MissingValueError`: `The attribute "<name>" is null.` or `undefined.` | Omit the absent attribute. Null is not an indexed nullable cell. |
| `UntypedValueError`: `Cannot infer an Arkiv type for <input>.` | Indexed application values need a supported scalar/tag; objects/arrays belong in payload. |
| `InvalidAttributeNameError`: `Invalid attribute name "<name>":` | Check name grammar/reserved words/32-byte bound. Use lowercase for the node; the SDK's error text permits uppercase more broadly. |
| `InvalidContentTypeError`: `Invalid content type "<type>".` | SDK requires lowercase MIME grammar. Use no parameters, e.g. `application/json`; `Text/Plain` fails. |
| `InvalidExpiryError`: `Invalid expiry:` | Construct with `ExpirationTime`; reject an already reached absolute deadline, fractional duration or u64 overflow. “dead on arrival” names a deadline at/before the checked head. |
| `EmptyPatchError`: `The patch for entity <key> has nothing to apply.` | Include `set`, `unset`, `payload` or `contentType`, or skip the operation. |
| `Error`: `No operations to perform` | SDK rejects an empty `executeBatch`. |
| `UnsupportedOperatorError`: `The query language does not define <operator> for a <tag>` | Choose a supported operator/tag pair, such as numeric ranges or string STARTSWITH. |
| `InvalidPredicateError` | Inspect its actual message: invalid system field/type, unfiltered builder or empty combinator needs different fixes. Exported `ne`, `exists` and `hasType` can still be rejected by the node. |
| `QueryError`: `Query rejected (<kind>, <code>)` | Use kind/code; query text and detail may contain sensitive literals. Do not expose raw errors in a public response. |
| `NoEntityFoundError`: `No entity found` / `No live entity with key <key>.` | Verify chain/key, deletion/expiration and requested snapshot. A missing live entity does not prove it never existed. |
| `NoMoreResultsError`: `No more results — the last page carried no cursor. Check hasNextPage() before next().` | Guard `next()` and replace the page reference after advancing. |
| `Error`: `Account required` | The wallet needs an explicit account. It can be wrapped by SDK mutation error handling. |
| `EntityMutationError` | Preserve `.txHash` if present and inspect `.cause`. Distinguish pre-broadcast rejection, uncertain broadcast, revert and successful receipt with decode failure. |
| Node: `Ident32InvalidByte` / selector `0x276f7798` | Retained uppercase-name rejection. Verify the offending application name byte; do not copy uppercase names from misleading examples. |
| Node ABI: `ExpiryNotExtended` | Target expiry is not greater than current expiry. Re-read after concurrent extension. |
| Node ABI: `EmptyBatch`, `AttributesNotSorted` | These revert names exist in the SDK ABI. SDK guards empty operations and sorts encoded attribute names; raw callers must compare their encoding. |
| Node observation: `contract creation is disabled (no-EVM Arkiv executor)` | Retained Tiramisu contract-creation rejection; native system entry-point operations remain valid. |
| JavaScript: `Do not know how to serialize a BigInt` | Explicitly serialize DTO bigint fields as strings; do not globally erase precision with Number. |

## Query RPC codes

This mapping comes from SDK `QueryErrorKind`, not an assertion that every code was triggered live here. Network messages vary; preserve the actual node response.

| Code | SDK kind | Recovery |
|---|---|---|
| `-32001` | `parse` | Fix expression syntax. |
| `-32002` | `type` | Fix operator/tag/capability mismatch. |
| `-32003` | `literal` | Fix range, checksum, string or decimal literal. |
| `-32004` | `limits` | Reduce the stated query budget; retain node detail. |
| `-32005` | `cursor` | Discard partial results and restart the full walk with identical scope. |
| `-32006` | `block` | Snapshot unavailable/outside retained range; preserve historical intent. |

For `-32602`, inspect the exact invalid-parameter detail. Retained examples include an unknown option (`resultsPerPage`, rather than `limit`) and a historical block that was not a JSON u64 number. Raw query `atBlock` uses a hex string; raw historical `arkiv_getEntity` uses a JSON number. Do not interchange them.

For HTTP `429`, honor `Retry-After` and current `ratelimit` headers before a bounded read retry. A retained anonymous-quota response used `ANON_COST_LIMITED`, but do not treat that body, quota or reset as permanent. A write rejection/timeout needs transaction reconciliation before any resend, even if the cause includes 429. For `401`/`403`, check the configured network and key policy without revealing the key. An invalid placeholder access key returned HTTP `401` with `INVALID_KEY` in retained Tiramisu evidence on 2026-10-05; preserve actual provider messages rather than hardcoding that body as a universal contract.

## A narrow typed diagnostic helper

This helper chooses a recovery path. It does not retry, reveal query/message text or establish whether an unknown transaction committed.

```typescript
import { EntityMutationError } from "@arkiv-network/sdk"
import { QueryError } from "@arkiv-network/sdk/query"

export function recoveryFor(error: unknown): {
  action: "reconcile_write" | "restart_walk" | "preserve_history" |
    "fix_query" | "wait_for_quota" | "inspect_evidence"
  transactionHash?: string
} {
  if (error instanceof EntityMutationError) {
    return { action: "reconcile_write", transactionHash: error.txHash }
  }
  if (error instanceof QueryError) {
    if (error.kind === "cursor") return { action: "restart_walk" }
    if (error.kind === "block") return { action: "preserve_history" }
    return { action: "fix_query" }
  }
  let cause: unknown = error
  for (let depth = 0; depth < 8 && typeof cause === "object" && cause !== null; depth++) {
    if ("status" in cause && cause.status === 429) return { action: "wait_for_quota" }
    cause = "cause" in cause ? cause.cause : undefined
  }
  return { action: "inspect_evidence" }
}
```

This helper assumes the actual typed SDK errors are passed through. SDK instances in another bundle/realm may fail `instanceof`; preserve structured discriminants in your own boundary or inspect the original cause safely. Generic RPC `-32001` outside `arkiv_query` can mean something else, so do not classify arbitrary Ethereum errors with this query mapping.
