---
name: arkiv-write-safety
description: Submit and reconcile Arkiv writes with @arkiv-network/sdk. Use for bulk imports, executeBatch, account writer queues, transaction versus entity nonces, TxParams, preflight funding, transport errors, EntityMutationError.txHash, receipt decoding failures, and durable progress across multiple transactions. Use arkiv-entity-lifecycle for mutation permissions and arkiv-entity-expiration for renewal targets.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-07"
---

# Arkiv write safety

One authorized account writer submits bounded batches and preserves every known transaction hash. A JavaScript exception does not establish that the chain rejected a write.

## Choose and prepare the write

- Validate stable row IDs, payloads and duplicate IDs before any wallet call. Freeze input order and intended fields so receipt keys and readback can be matched to the prepared rows.
- For importing 5,000 rows, use multiple `executeBatch({ creates })` transactions with durable per-batch progress. Choose batch sizes from encoded size, gas estimates, provider limits, and an approved spend budget; there is no verified universal 1,000-operation cap.
- One native batch is atomic. The SDK applies creates, patches, deletes, extensions, then ownership changes; property order in the input object does not reorder them. Multiple batches are separate transactions and can leave partial progress.
- Use `arkiv-entity-lifecycle` for permissions and relationship ordering, `arkiv-entity-expiration` for renewal calculations, and `arkiv-security-trust` for signer custody.
- Check configured network, connected account, current permissions, deadline, and GLM balance before submission. Compare an unsigned estimate and fee cap, with a margin, against both balance and approved remaining spend. Estimates spend no GLM, but the provider can still reject balance or fee fields. They do not authorize a funded send.
- Use lowercase MIME types such as `application/json`. The SDK sorts attribute cells by their encoded names; raw ABI callers must do so themselves. An empty batch throws `Error("No operations to perform")`; an empty patch throws `EmptyPatchError`. Skip empty work.
- Keep payload limits separate from total encoded transaction limits: ABI framing, attributes, and every operation add bytes. Do not present a payload limit as the transaction limit.

## Nonces, fees, and predictions

Serialize all writes for an account. `Promise.all` over wallet writes can collide on transaction nonces; a queue in one process cannot coordinate another tab, server, wallet application, or process. Use an account-wide coordinator or exclusive custody when correctness depends on ordering.

The transaction nonce orders Ethereum-compatible transactions. The **entity-minting nonce** is a separate counter per creator and advances for each create. Pass the creating signer's address as `owner` in `reader.predictEntityKeys({ owner, count })` or `reader.predictEntityKeys({ owner, salts })`; with `salts`, their length determines the count. This counter is not `getTransactionCount()` and does not follow later ownership transfers. Hold exclusive access to every create between prediction and submission, use exactly the predicted salts, and verify receipt keys. An intervening create can invalidate relationships even if transaction nonce allocation was correct.

Pass `TxParams` as the write method's second argument: `{ gas, nonce, gasPrice }` for legacy fees, or `{ gas, nonce, maxFeePerGas, maxPriorityFeePerGas }` for EIP-1559. Fee styles are mutually exclusive. Omitted fields use wallet estimation; explicit values are the caller's responsibility. Never reuse one fixed transaction nonce across a multi-batch import.

## Reconcile before another submission

| Observed state | Action |
| --- | --- |
| Validation, unsigned estimate, or checkpoint failed; instrumented send admission was never reached | No broadcast occurred through that guarded path. Fix inputs, gas/funding, or persistence before retrying. |
| Send admission was reached, or an uninstrumented wallet call failed without a known hash | Outcome is uncertain. Stop automatic resubmission and authenticate signer/nonce/provider history. An unchanged nonce or empty query does not prove rejection. |
| Raw bytes/hash were durably captured but forwarding may not have begun | Retain the original bytes/hash and nonce; reconcile first. Never re-sign or allocate a replacement nonce automatically. |
| Known hash; receipt unavailable | Keep the hash and wait/reconcile. An RPC lookup error does not mean the transaction disappeared. |
| Receipt successful; SDK event decoding/count failed | The batch applied. `EntityMutationError.txHash` preserves the hash. Recover identities from receipt logs and matching input order; never recreate automatically. |
| Receipt reverted | Entity operations did not apply; gas may still have been spent. Inspect the reason, fix it, and retry only under the remaining authorization. |
| Receipt successful; later read/checkpoint failed | Preserve confirmed keys/hash. Repair verification or the checkpoint before admitting another batch. |

RPC transport retries and submitting a new transaction are different actions. Do not convert a transport retry policy into application retries around `createEntity()` or `executeBatch()`. An application `row_id` helps reconciliation but is not protocol uniqueness or automatic idempotency.

## Worked crash-safe importer

Use [the resumable Node importer](references/resumable-import.md) for a complete create-only workflow. Its executable helper prepares and loads an immutable plan, coordinates processes on one host, captures signed bytes/hash before forwarding, and verifies the full transaction, canonical receipt, predicted key order, and fresh fields before checkpointing.

1. Prepare one plan under exclusive signer custody. Freeze row order, salts, absolute expirations, account/chain/genesis, batch numbers, transaction nonces, SDK calldata, gas, fees, and spend cap. Retain the returned plan hash in a trusted job entry.
2. Fsync the plan and journal before admission. Each raw send authenticates the local signature and exact frozen intent, then fsyncs signed bytes and their hash **before** the provider request. If this save fails, the wrapper does not forward the send.
3. Stop after any uncertain send, receipt/verification failure, or checkpoint failure. The pre-send journal survives receipt-wait crashes and lost responses even when `EntityMutationError.txHash` is absent.
4. Restart with the original plan hash and files. Load durable state, authenticate every captured hash before continuing, and skip verified batches. Do not infer batch numbers from the current result-array length or restart the original rows.
5. Confirm only after matching sender, nonce, native address, input, fee fields, receipt block/provenance, event order, predicted keys, and typed entity readback. Event count alone cannot authenticate a hash. A failed post-send save leaves the earlier submitting entry available for recovery.

The helper refuses automatic rebroadcast. An operator may consider resending the **same signed bytes** only after explicit reconciliation; signing new bytes while the previous nonce can still land risks replacement or duplicate application work. Expired or changed entities cause this conservative example to stop, never recreate.

`EntityMutationError` without a hash, including "Execution error without revert data", can follow a lost send response. Classify recovery by observed phase and durable admission evidence, not the exception class or message. A reverted receipt establishes failure; an unsigned estimate rejection does not establish a mined revert. Supplying explicit gas can bypass estimation and produce a paid revert.

For older uninstrumented jobs, use the saved start block and pinned signer/nonce to locate candidate transactions. Authenticate the complete intended input and receipt before adopting one. A consumed nonce can belong to a different transaction. Keep unresolved work stopped if the hash or intended transaction cannot be established.

## Verification and sources

The helper's local regressions exercise SDK 0.8.1 serialization/receipt decoding, a lost raw-send response, a real process exit and restart with original files, cross-process admission, failed fsync/checkpoints, plan and hash mismatches, typed readback, expired plans, and changed genesis. Controlled-provider tests establish these paths; they do not certify real provider limits, funded transactions, distributed custody, or machine power-loss durability.

- [SDK 0.8.1 native encoding, send and receipt handling](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts).
- [SDK 0.8.1 executeBatch result](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/executeBatch.ts), [TxParams](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/txParams.ts), and [entity-key prediction](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/predictEntityKeys.ts).
- [Native mutations, events, and reverts](https://docs.arkiv.network/json-rpc/mutating-entities/).
