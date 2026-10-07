---
name: arkiv-write-safety
description: Submit and reconcile Arkiv writes with @arkiv-network/sdk. Use for bulk imports, executeBatch, account writer queues, transaction versus entity nonces, TxParams, preflight funding, transport errors, EntityMutationError.txHash, receipt decoding failures, and durable progress across multiple transactions. Use arkiv-entity-lifecycle for mutation permissions and arkiv-entity-expiration for renewal targets.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-05"
---

# Arkiv write safety

One authorized account writer submits bounded batches and preserves every known transaction hash. A JavaScript exception does not establish that the chain rejected a write.

## Choose and prepare the write

- Validate stable row IDs, payloads and duplicate IDs before any wallet call. Freeze input order and intended fields so receipt keys and readback can be matched to the prepared rows.
- For importing 5,000 rows, use multiple `executeBatch({ creates })` transactions with durable per-batch progress. Choose batch sizes from encoded size, gas estimates, provider limits, and an approved spend budget; there is no verified universal 1,000-operation cap.
- One native batch is atomic. The SDK applies creates, patches, deletes, extensions, then ownership changes; property order in the input object does not reorder them. Multiple batches are separate transactions and can leave partial progress.
- Use `arkiv-entity-lifecycle` for permissions and relationship ordering, `arkiv-entity-expiration` for renewal calculations, and `arkiv-security-trust` for signer custody.
- Check configured network, connected account, current permissions, deadline, and GLM balance before submission. A positive balance alone does not prove it covers gas. An estimate needs no funds, but does not authorize a funded send.
- Use lowercase MIME types such as `application/json`. The SDK sorts attribute cells by their encoded names; raw ABI callers must do so themselves. An empty batch throws `Error("No operations to perform")`; an empty patch throws `EmptyPatchError`. Skip empty work.
- Keep payload limits separate from total encoded transaction limits: ABI framing, attributes, and every operation add bytes. Do not present a payload limit as the transaction limit.

## Nonces, fees, and predictions

Serialize all writes for an account. `Promise.all` over wallet writes can collide on transaction nonces; a queue in one process cannot coordinate another tab, server, wallet application, or process. Use an account-wide coordinator or exclusive custody when correctness depends on ordering.

The transaction nonce orders Ethereum-compatible transactions. The **entity-minting nonce** is a separate counter per creator and advances for each create. Pass the creating signer's address as `owner` in `reader.predictEntityKeys({ owner, count })` or `reader.predictEntityKeys({ owner, salts })`; with `salts`, their length determines the count. This counter is not `getTransactionCount()` and does not follow later ownership transfers. Hold exclusive access to every create between prediction and submission, use exactly the predicted salts, and verify receipt keys. An intervening create can invalidate relationships even if transaction nonce allocation was correct.

Pass `TxParams` as the write method's second argument: `{ gas, nonce, gasPrice }` for legacy fees, or `{ gas, nonce, maxFeePerGas, maxPriorityFeePerGas }` for EIP-1559. Fee styles are mutually exclusive. Omitted fields use wallet estimation; explicit values are the caller's responsibility. Never reuse one fixed transaction nonce across a multi-batch import.

## Reconcile before another submission

| Observed state | Action |
| --- | --- |
| Proven local validation/checkpoint failure before the wallet call | Fix inputs or persistence; no write was attempted by that call. |
| Wallet submission failed or timed out without a known hash | Broadcast outcome is unknown. Inspect signer/account nonce, wallet/provider history, and transaction data. Stop automatic resubmission. |
| Known hash; receipt unavailable | Keep the hash and wait/reconcile. An RPC lookup error does not mean the transaction disappeared. |
| Receipt successful; SDK event decoding/count failed | The batch applied. `EntityMutationError.txHash` preserves the hash. Recover identities from receipt logs and matching input order; never recreate automatically. |
| Receipt reverted | Entity operations did not apply; gas may still have been spent. Inspect the reason, fix it, and retry only under the remaining authorization. |
| Receipt successful; later read/checkpoint failed | Preserve confirmed keys/hash. Repair verification or the checkpoint before admitting another batch. |

RPC transport retries and submitting a new transaction are different actions. Do not convert a transport retry policy into application retries around `createEntity()` or `executeBatch()`. An application `row_id` helps reconciliation but is not protocol uniqueness or automatic idempotency.

## Worked serialized import and hash recovery

This example sends only when its exported importer is called. The caller supplies an authorized wallet, validated rows, a measured batch size, and `save`, a durable journal that resolves only after persistence. Keep one queue per account and coordinate other writers separately. The example stops at the first uncertain write or failed outcome checkpoint.

`confirmed` denotes a successful chain receipt; it does not mean the import is fully verified. For a confirmed outcome, the caller's `save` handler first persists the hash and keys, then checks the receipt, matching transaction inputs/key order and fresh intended fields before resolving. If verification fails, throw from that handler: the importer saves `checkpointError` and stops the next batch while preserving the confirmed identities. Advance a separate verified-completion checkpoint only after every batch passes these checks; never discard a known hash or resend because readback failed.

```typescript
import {
  createPublicClient, createWalletClient, EntityMutationError,
  ENTITY_EVENTS_ABI, ExpirationTime, jsonToPayload,
} from "@arkiv-network/sdk"
import type { TxParams } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { decodeEventLog } from "viem"
import type { Hex } from "viem"

type Reader = ReturnType<typeof createPublicClient>
type Wallet = ReturnType<typeof createWalletClient>
type Row = { id: string; body: string }
type Progress = {
  jobId: string; batch: number; rowIds: string[]
  state: "prepared" | "submitting" | "confirmed" | "needs_reconciliation" | "before_submission_failed"
  txHash?: Hex; createdEntities?: Hex[]; errorName?: string; checkpointError?: string
}
type ReceiptInspection = {
  txHash: Hex; candidateEntityKeys: Hex[]; errorName?: string
  state: "receipt_success" | "receipt_unavailable" | "receipt_reverted" | "receipt_decode_incomplete"
}
type Save = (progress: Progress) => Promise<void>
const SYSTEM_ADDRESS = "0x4400000000000000000000000000000000000044"
const errorName = (error: unknown) => error instanceof Error ? error.name : "UnknownError"

export function createSerialWriter() {
  let tail: Promise<unknown> = Promise.resolve()
  return function run<T>(task: () => Promise<T>): Promise<T> {
    const next = tail.then(task)
    tail = next.catch(() => undefined)
    return next
  }
}

async function saveOutcome(progress: Progress, save: Save): Promise<Progress> {
  try { await save(progress); return progress }
  catch (error) { return { ...progress, checkpointError: errorName(error) } }
}

export async function importRows(
  run: ReturnType<typeof createSerialWriter>, reader: Reader, wallet: Wallet,
  jobId: string, rows: Row[], batchSize: number, save: Save, txParams?: TxParams,
) {
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) throw new Error("Invalid batch size")
  if (!jobId || rows.some(row => !row.id || typeof row.body !== "string")) {
    throw new Error("Provide a stable job ID and validated rows")
  }
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate row IDs")
  if (txParams?.nonce !== undefined) throw new Error("Allocate transaction nonces per batch")
  if (reader.chain?.id !== tiramisu.id || wallet.chain?.id !== tiramisu.id || !wallet.account) {
    throw new Error("Connect reader and wallet to Tiramisu")
  }
  return run(async () => {
    const progress: Progress[] = []
    for (let start = 0; start < rows.length; start += batchSize) {
      const slice = rows.slice(start, start + batchSize)
      const step = { jobId, batch: progress.length, rowIds: slice.map(row => row.id) }
      const creates = slice.map(row => ({
        payload: jsonToPayload({ body: row.body }), contentType: "application/json",
        attributes: { project: "import_example", import_id: jobId, row_id: row.id },
        expires: ExpirationTime.fromDays(30),
      }))
      try {
        if (await reader.getBalance({ address: wallet.account!.address }) === 0n) {
          throw new Error("Fund the connected account with testnet GLM before writing")
        }
      } catch (error) {
        progress.push(await saveOutcome({ ...step, state: "before_submission_failed",
          errorName: errorName(error) }, save))
        break
      }
      await save({ ...step, state: "prepared" })
      await save({ ...step, state: "submitting" })
      let outcome: Progress
      try {
        const result = await wallet.executeBatch({ creates }, txParams)
        outcome = { ...step, state: "confirmed", txHash: result.txHash,
          createdEntities: result.createdEntities }
      } catch (error) {
        outcome = { ...step, state: "needs_reconciliation", errorName: errorName(error),
          txHash: error instanceof EntityMutationError ? error.txHash : undefined }
      }
      const recorded = await saveOutcome(outcome, save)
      progress.push(recorded)
      if (recorded.state !== "confirmed" || recorded.checkpointError) break
    }
    return progress
  })
}

export async function inspectCreateReceipt(
  reader: Reader, txHash: Hex, expectedCreates: number,
): Promise<ReceiptInspection> {
  if (!Number.isSafeInteger(expectedCreates) || expectedCreates <= 0) {
    throw new Error("Provide the expected positive create count")
  }
  const inspection = { txHash, candidateEntityKeys: [] as Hex[] }
  let receipt
  try { receipt = await reader.getTransactionReceipt({ hash: txHash }) }
  catch (error) { return { ...inspection, state: "receipt_unavailable", errorName: errorName(error) } }
  if (receipt.status === "reverted") return { ...inspection, state: "receipt_reverted" }
  const keys: Hex[] = []
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== SYSTEM_ADDRESS) continue
    try {
      const decoded = decodeEventLog({ abi: ENTITY_EVENTS_ABI, topics: log.topics, data: log.data })
      if (decoded.eventName === "EntityCreated") keys.push(decoded.args.entityKey)
    } catch { /* Preserve success, but never infer a key from an undecodable log. */ }
  }
  return { txHash, candidateEntityKeys: keys,
    state: keys.length === expectedCreates ? "receipt_success" : "receipt_decode_incomplete" }
}
```

Call `inspectCreateReceipt` only when a hash is known. It reports receipt status and candidate keys, never changes a job to confirmed or associates keys with rows. For reconciliation, use a hash recorded for this exact job on this network, fetch `reader.getTransaction({ hash })`, and match sender, native destination, decoded input operation count/order, and stored batch inputs before assigning keys or updating the journal. A matching event count alone does not authenticate an arbitrary hash. Preserve the original rows and keys alongside journal state.

On resume, reconcile every `submitting` or uncertain checkpoint first. Continue only explicitly unresolved rows after proving prior results. Do not restart the whole import or treat absence from a query as proof no earlier create succeeded: the entity could be deleted/expired, the namespace wrong, or the RPC unavailable. Report confirmed batches, keys/hashes, the stopped batch, and pending inputs for every multi-transaction workflow.

## Verification and sources

Verify receipt status, native operation events, resulting keys, and intended field changes. Fresh reads can fail independently after confirmation. If available, connected read-only `verify_tx`/`verify_entity` tools may supplement these checks; inspect their schema and keep signing keys in the developer's wallet/server.

- [Native mutations, batches, events, and reverts](https://docs.arkiv.network/json-rpc/mutating-entities/).
- [SDK source](https://github.com/Arkiv-Network/arkiv-sdk-js): published 0.8.1 `src/utils/arkivTransactions.ts`, `src/actions/wallet/executeBatch.ts`, `src/types/txParams.ts`, `src/errors.ts`, and `src/actions/public/predictEntityKeys.ts`.
