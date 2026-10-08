# Testing a first write

Test the installed SDK with an in-memory transport or deterministic HTTP fixture. A mock validates application behavior and SDK encoding, not persisted chain state. Keep these cases distinct:

| Case | Observable result |
| --- | --- |
| Fresh seed | Guarded estimate before the write; one native create; lowercase names, u64 timestamp, MIME and readonly flags match receipt-block read-back. Expiry minus inclusion block equals the requested lifetime. |
| Existing readonly seed with matching payload, MIME and typed timestamp | Return its key; no create, balance check or broadcast. |
| Duplicate or changed seed | Fail before sending; preserve existing entities. |
| Wrong network / zero balance / dust balance / missing estimator | No broadcast. The funding gate includes the rounded-up 20% gas margin and current fee cap. |
| Confirmed receipt missing expected create log | `EntityMutationError.txHash` retained; inspect receipt and identity; no resend. |
| Reverted receipt | Report failure; change the input or state before a separately authorized retry. |
| Receipt read or query failure / changed read-back | Structured error retains entityKey, txHash and known receiptBlock/gasUsed; reconcile without a new create. |
| Access key on another origin / redirected RPC | Fail closed; never forward the header to another origin. |
| Generic estimate callback catches the guard / throws an unrelated failure | Report estimation failure; zero signatures on the normal estimate path and zero forwarded broadcasts. |
| Multi-page seed lookup | Pin a block; assign each returned page; discard partial results on a cursor restart; bound retries. |
| Entity Expiration | Compare blocks as bigint; returned create expiry comes from the receipt; elapsed time is not a wall-clock lock. |

For a live smoke, agree on the signer, Tiramisu network, maximum writes and spend first. Estimate the exact payload without broadcasting, then create only within that budget and read by returned key. Report whether a real write/read-back happened or only an estimate/fixture passed. Never log a key, raw signed transaction or authorization header.

The SDK exports a `localhost` chain configuration; that export is not an installed local node. Do not promise a runnable devnet from it alone.

The estimate preserves the SDK's fee fields and complete estimation request. A successful estimate is not proof that the signed-submission request fits a provider's HTTP body limit. An unfunded account may fail provider balance checks during estimation; report that limitation without weakening the guard.

Sources: [SDK 0.8.1 create action](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/createEntity.ts), [transaction and receipt handling](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts).
