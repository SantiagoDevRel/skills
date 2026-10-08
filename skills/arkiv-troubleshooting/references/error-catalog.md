# SDK 0.8.1 error catalog

Messages in quotes below are exact SDK message stems; `<...>` marks a dynamic value, not literal text to match. SDK errors can be wrapped by `EntityMutationError` or viem, so retain their cause chain. Node observations are labeled separately.

| Class or exact stem | Meaning and correction |
|---|---|
| `InvalidValueError`: `Invalid i32 value <input>: <reason>.` | Bare number defaults to i32. Millisecond timestamps need an explicitly chosen larger tag such as u64; `u64` cannot store negatives. Check the actual tag and input. |
| `MissingValueError`: `The attribute "<name>" is null.` or `undefined.` | Omit the absent attribute. Null is not an indexed nullable cell. |
| `UntypedValueError`: `Cannot infer an Arkiv type for <input>.` | Indexed application values need a supported scalar/tag; objects/arrays belong in payload. |
| `InvalidAttributeNameError`: `Invalid attribute name "<name>":` | Check name grammar/reserved words/32-byte bound. Use lowercase for the node; the SDK's error text permits uppercase more broadly. |
| `InvalidContentTypeError`: `Invalid content type "<type>".` | SDK requires lowercase MIME grammar. Use no parameters, e.g. `application/json`; `Text/Plain` fails. |
| `InvalidExpiryError`: `Invalid expiry:` | Construct with `ExpirationTime`; converted seconds must be positive integers divisible by Tiramisu's two-second block interval. Fractional hours/minutes are valid when that conversion is exact. Reject reached absolute deadlines and u64 overflow. “dead on arrival” names a deadline at/before the checked head. |
| `EmptyPatchError`: `The patch for entity <key> has nothing to apply.` | Include `set`, `unset`, `payload` or `contentType`, or skip the operation. |
| `Error`: `No operations to perform` | SDK rejects an empty `executeBatch`. |
| `UnsupportedOperatorError`: `The query language does not define <operator> for a <tag>` | Choose a supported operator/tag pair, such as numeric ranges or string STARTSWITH. |
| `InvalidPredicateError` | Inspect its actual message: invalid system field/type, unfiltered builder or empty combinator needs different fixes. Exported `ne`, `exists` and `hasType` can still be rejected by the node. |
| `QueryError`: `Query rejected (<kind>, <code>)` | Use kind/code and the node's `error.data.message`/position. The text after the colon may be viem's generic EIP-1474 label, not the node reason. Redact literals before sharing; never expose raw query errors publicly. |
| `NoEntityFoundError`: `No entity found` / `No live entity with key <key>.` | Verify chain/key, deletion/expiration and requested snapshot. A missing live entity does not prove it never existed. |
| `NoMoreResultsError`: `No more results — the last page carried no cursor. Check hasNextPage() before next().` | Guard `next()` and replace the page reference after advancing. |
| `Error`: `Account required` / `Chain required` | Plain errors thrown before RPC and outside SDK mutation wrapping. Configure an explicit account and chain. |
| `EntityMutationError` | Preserve `.txHash` if present and inspect `.cause`. Distinguish pre-broadcast rejection, uncertain broadcast, revert and successful receipt with decode failure. |
| `outside the name charset` / decoded `Ident32InvalidByte` / selector `0x276f7798` | Retained uppercase-name rejection. SDK 0.8.1's sentence lists A-Z despite Tiramisu rejecting uppercase bytes. Use lowercase application names. |
| `no entity <key> — it may have been deleted, or have expired` | First verify the value is an entity key rather than a transaction hash (`eth_getTransactionByHash`); then inspect creation, deletion and expiration history. |
| `entity <key> is owned by <owner>, not <caller>` | Decoded `NotOwner`: inspect current owner and signer. This diagnostic does not by itself prove no broadcast. |
| `entity <key> was created readonly` | Decoded `ReadOnlyEntity`: publish an authenticated replacement; do not retry a patch. |
| `already expires at block <n>, so extending it to <m> would shorten its life` | Decoded `ExpiryNotExtended`: target the actual current deadline plus the intended increment. |
| `gas required exceeds: <n>` | Inspect the unsigned estimate cause, signer funding and fee cap. For `0`, also compare RPC `eth_chainId` to the client chain; a local account does not guarantee a URL/chain match. No-send certainty requires instrumented phase evidence. |
| Node ABI: `ExpiryNotExtended` | Inspect the requested/current deadlines and actual revert data; re-read after concurrent extension. Retained Tiramisu estimates rejected a shorter target but accepted an equal target. Equal requests add no lifetime; an estimate is not a mined execution. |
| Node ABI: `EmptyBatch`, `AttributesNotSorted` | These revert names exist in the SDK ABI. SDK guards empty operations and sorts encoded attribute names; raw callers must compare their encoding. |
| Node observation: `contract creation is disabled (no-EVM Arkiv executor)` | Retained Tiramisu contract-creation rejection; native system entry-point operations remain valid. |
| JavaScript: `Do not know how to serialize a BigInt` | Identify where serialization failed. If `JSON.stringify(await createEntity(...))` threw after the call returned, the write already completed: do not run it again. Preserve or recover the original entity key/hash using the operation journal, signer nonce and authenticated receipt; a creator-scoped natural-key query is a lookup aid, not proof of uniqueness. Follow `arkiv-write-safety` before adding a narrow DTO with bigint fields as decimal strings. |

## Query RPC codes

This mapping comes from SDK `QueryErrorKind`, not an assertion that every code was triggered live here. Network messages vary; preserve the actual node response.

| Code | SDK kind | Recovery |
|---|---|---|
| `-32001` | `parse` | Fix expression syntax. |
| `-32002` | `type` | Fix operator/tag/capability mismatch. |
| `-32003` | `literal` | Fix range, checksum, string or decimal literal. |
| `-32004` | `limits` | Reduce the stated query budget; retain node detail. |
| `-32005` | `cursor` | Discard partial results and restart the full walk with identical scope. |
| `-32006` | `block` | Snapshot unavailable/outside retained range or ahead of the endpoint's tip; check uncached head/endpoint drift and preserve historical intent. |

For `-32602`, inspect the exact invalid-parameter detail. Retained examples include an unknown option (`resultsPerPage`, rather than `limit`) and a historical block that was not a JSON u64 number. Raw query `atBlock` uses a hex string; raw historical `arkiv_getEntity` uses a JSON number. Do not interchange them.

For HTTP `429`, honor `Retry-After` and current `ratelimit` headers before a bounded read retry. A retained anonymous-quota response used `ANON_COST_LIMITED`, but do not treat that body, quota or reset as permanent. A write rejection/timeout needs transaction reconciliation before any resend, even if the cause includes 429. For `401`/`403`, check the configured network and key policy without revealing the key. An invalid placeholder access key returned HTTP `401` with `INVALID_KEY` in retained Tiramisu evidence on 2026-10-05; preserve actual provider messages rather than hardcoding that body as a universal contract.

For HTTP `413`, measure the encoded JSON-RPC request, not only the payload. On 2026-10-06, three unsigned Tiramisu create estimates with a 131,072-byte payload returned `413`, including a payload-only operation. This is an HTTP ingress observation, not a contract revert or deployed consensus maximum. SDK mutation wrapping can replace the outer message with `Transaction failed: Execution error without revert data`; retain the original HTTP cause. Reduce the request size or use chunking, then estimate again. If a broadcast was attempted, reconcile its known hash before considering a resend.

viem's HTTP transport retries before an application retry loop and can retry `413` as well as `429`. Set `retryCount: 0` when the application owns the bounded retry policy; do not repeatedly upload an oversized body. A missing hash, estimate-shaped error or unchanged nonce alone does not prove the send boundary was never reached.

## A narrow typed diagnostic helper

This helper chooses a recovery path. It does not retry, reveal query/message text or establish whether an unknown transaction committed.

```typescript
import { EntityMutationError } from "@arkiv-network/sdk"
import { QueryError } from "@arkiv-network/sdk/query"
import { ContractFunctionRevertedError } from "viem"

function causes(error: unknown): object[] {
  const result: object[] = []
  let current = error
  while (typeof current === "object" && current !== null &&
         result.length < 16 && !result.includes(current)) {
    result.push(current)
    current = "cause" in current ? current.cause : undefined
  }
  return result
}

export function decodedRevertName(error: unknown): string | undefined {
  for (const cause of causes(error)) {
    if (cause instanceof ContractFunctionRevertedError) return cause.data?.errorName
  }
  return undefined
}

export function recoveryFor(error: unknown, sendAdmission: "not_reached" | "reached" | "unknown" = "unknown"): {
  action: "reconcile_write" | "restart_walk" | "preserve_history" |
    "fix_query" | "fix_permission" | "reduce_request_size" |
    "wait_for_quota" | "inspect_evidence"
  transactionHash?: string | undefined
} {
  if (error instanceof EntityMutationError) {
    // Set not_reached only from the durable writer's instrumented admission record.
    if (!error.txHash && sendAdmission === "not_reached") {
      if (causes(error).some(cause => "status" in cause && cause.status === 413)) {
        return { action: "reduce_request_size" }
      }
      if (["NotOwner", "ReadOnlyEntity", "ExpiryNotExtended"].includes(decodedRevertName(error) ?? "")) {
        return { action: "fix_permission" }
      }
    }
    return { action: "reconcile_write", transactionHash: error.txHash }
  }
  if (error instanceof QueryError) {
    if (error.kind === "cursor") return { action: "restart_walk" }
    if (error.kind === "block") return { action: "preserve_history" }
    return { action: "fix_query" }
  }
  for (const cause of causes(error)) {
    if ("status" in cause && cause.status === 429) return { action: "wait_for_quota" }
  }
  return { action: "inspect_evidence" }
}
```

This helper assumes the actual typed SDK errors are passed through. SDK instances in another bundle/realm may fail `instanceof`; preserve structured discriminants in your own boundary or inspect the original cause safely. Generic RPC `-32001` outside `arkiv_query` can mean something else, so do not classify arbitrary Ethereum errors with this query mapping.

`sendAdmission` is trusted local journal evidence, never a user field inferred from the error. With unknown admission, an unsigned estimate cause can suggest an input, permission, funding or chain correction while the original write remains subject to reconciliation. Do not turn that suggestion into an automatic resend.

## Serialize a completed write without repeating it

Separate the wallet call from serialization. The durable writer in `arkiv-write-safety` captures the transaction hash before broadcast; after confirmation, persist the returned identities before formatting a response. If persistence or response serialization fails, reconcile that operation ID instead of calling the wallet again.

```typescript
import type { Hex } from "viem"

export function createResultDto(result: {
  entityKey: Hex; txHash: Hex; expiresAt: bigint
}) {
  return { arkivEntityKey: result.entityKey, transactionHash: result.txHash,
    expiresAtBlock: result.expiresAt.toString() }
}
```

A serialization error before the wallet call is a local failure. The same error after the call cannot establish that nothing was written. Do not convert a block number to `Number` merely to make JSON work.
