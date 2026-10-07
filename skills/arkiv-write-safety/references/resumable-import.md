# A resumable Node importer

Copy the JavaScript block to `resumable-import.mjs` in your application. It uses public SDK 0.8.1 APIs and Node built-ins. Supply a local account from your existing signer custody and a provider `request({ method, params })` configured without automatic retries. Neither entrypoint reads keys, creates an HTTP transport, or runs on import.

Call `prepareImport(options)` once, retain its `planSha256` in a trusted job record, then call `runImport({ ...options, planSha256 })`. On restart, call **only** `runImport` with that original hash and the original files. Preparation requires `rows`, `jobId`, `batchSize`, `fees`, `gasCeiling`, and `maxTotalCost`. Each row is `{ id, payload: Uint8Array, contentType, attributes, salt: bigint, expiresAt: bigint, flags? }`. All expiry targets are absolute; the SDK may reject a deadline that is no longer live. Fees are `{ gasPrice: bigint }` or `{ maxFeePerGas: bigint, maxPriorityFeePerGas: bigint }`. Common options are `account`, `chain`, `request`, `planPath`, and `journalPath`; their parent directories must already exist.

All writers sharing this signer must use this coordinator on the same host, or you must retain exclusive signer custody. The loopback listener is a mutex, not an HTTP service: it closes incoming sockets and the OS releases it on process exit. A port collision refuses admission. This does not coordinate signers on different machines or wallet applications that bypass it. The plan captures the account, chain ID and genesis hash, port, starting transaction nonce, predicted entity keys, ordered rows, exact SDK calldata, gas, fees, and total spend cap.

The journal stores signed bytes and their hash **before** forwarding a send. Keep it private: signed bytes can be rebroadcast by someone who obtains them, and calldata exposes the payload. Never print it or commit it. Every append calls `FileHandle.sync()`. A torn record, altered plan, uncertain send, failed save, changed nonce, missing receipt, reverted receipt, reorg, or mismatching readback stops the job. A restart never resends captured bytes automatically. If a crash happened between durable capture and provider admission, a missing receipt still requires operator reconciliation; an empty query is not permission to create again.

This is process-crash recovery over an existing durable filesystem, not a guarantee against storage loss or machine power failure. Provision and back up the job directory before starting; this example does not fsync its parent directory or provide distributed locking. Confirmed batches are authenticated again on restart. If entities have expired or been changed since confirmation, this conservative example stops instead of recreating them.

```javascript
import { createHash } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { createServer } from "node:net";
import {
  createPublicClient, createWalletClient, ENTITY_EVENTS_ABI, ExpirationTime,
  MAX_PAYLOAD_BYTES, addr, bool, bytes32, dec, decUnits, i32, key, str,
  toValue, u64, u256,
} from "@arkiv-network/sdk";
import { eq } from "@arkiv-network/sdk/query";
import {
  bytesToHex, custom, decodeEventLog, decodeFunctionData, hexToBytes,
  keccak256, parseAbi, parseTransaction, recoverTransactionAddress,
} from "viem";

const NATIVE = "0x4400000000000000000000000000000000000044";
const EXECUTE = parseAbi(["function execute((uint8 operation, bytes operationData)[] ops)"]);
const READS = new Set([
  "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount",
  "eth_estimateGas", "eth_getBalance", "eth_gasPrice", "eth_maxPriorityFeePerGas",
  "eth_getTransactionReceipt", "eth_getTransactionByHash", "eth_call", "arkiv_query",
]);
const digest = (s) => createHash("sha256").update(s).digest("hex");
const json = (x) => JSON.stringify(x, (_, v) => typeof v === "bigint" ? v.toString() : v);
const sameAddress = (a, b) => typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
const check = (ok, why) => { if (!ok) throw new Error(why); };
const errorName = (e) => e instanceof Error ? e.name : "UnknownError";
const scalar = { addr, bool, bytes32, dec, i32, key, str, u64, u256 };
const bigintTypes = new Set(["u64", "u256"]);
const typed = (v) => {
  const constructor = scalar[v.type];
  check(typeof constructor === "function", "Unsupported persisted attribute type");
  return constructor(bigintTypes.has(v.type) ? BigInt(v.value) : v.value);
};
function canonicalValue(v) {
  const x = toValue(v);
  return { type: x.type, value: x.type === "dec" ? decUnits(x).toString()
    : x.type === "addr" ? x.value.toLowerCase() : typeof x.value === "bigint" ? x.value.toString() : x.value };
}
function hydrate(row) {
  return {
    payload: hexToBytes(row.payloadHex), contentType: row.contentType,
    attributes: Object.fromEntries(Object.entries(row.attributes).map(([n, v]) => [n, typed(v)])),
    salt: BigInt(row.salt), expires: ExpirationTime.atBlock(BigInt(row.expiresAt)), flags: row.flags,
  };
}
function freezeRow(row) {
  check(typeof row.id === "string" && row.id.length > 0, "Stable row ID required");
  check(row.payload instanceof Uint8Array && row.payload.length <= MAX_PAYLOAD_BYTES, "Payload exceeds SDK limit");
  check(typeof row.salt === "bigint" && typeof row.expiresAt === "bigint", "Explicit salt and absolute expiry required");
  const attributes = Object.fromEntries(Object.entries(row.attributes ?? {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([n, v]) => [n, JSON.parse(json(toValue(v, n)))]));
  return { id: row.id, payloadHex: bytesToHex(row.payload), contentType: row.contentType,
    attributes, salt: row.salt.toString(), expiresAt: row.expiresAt.toString(),
    flags: { readonly: row.flags?.readonly ?? false, permissionlessExtension: row.flags?.permissionlessExtension ?? false } };
}
function portFor(chainId, address) {
  return 20000 + Number.parseInt(digest(`${chainId}:${address.toLowerCase()}`).slice(0, 8), 16) % 30000;
}
async function withCustody(account, chain, task) {
  check(account?.type === "local" && typeof account.address === "string", "Local account required; external wallets need their own durable capture");
  check(Number.isSafeInteger(chain?.id) && chain.id > 0, "Explicit chain required");
  const port = portFor(chain.id, account.address);
  const server = createServer((socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port, exclusive: true }, resolve);
  });
  try { return await task(port); }
  finally { await new Promise((resolve, reject) => server.close((e) => e ? reject(e) : resolve())); }
}
function clients(account, chain, request) {
  const read = async (r) => {
    check(READS.has(r.method), "Unexpected provider method");
    return request(r);
  };
  return { read, reader: createPublicClient({ chain, cacheTime: 0, transport: custom({ request: read }, { retryCount: 0 }) }) };
}
async function createFile(path, text) {
  const file = await open(path, "wx", 0o600);
  try { await file.writeFile(text, "utf8"); await file.sync(); }
  finally { await file.close(); }
}
async function loadJournal(path, planSha256) {
  const text = await readFile(path, "utf8");
  check(text.endsWith("\n"), "Torn journal; reconcile without new writes");
  const records = text.trimEnd().split("\n").map((s) => JSON.parse(s));
  let previous = "";
  for (const record of records) {
    const { hash, ...body } = record;
    check(body.planSha256 === planSha256 && body.previous === previous && hash === digest(json(body)), "Journal integrity failure");
    previous = hash;
  }
  check(records[0]?.state === "initialized", "Journal header missing");
  return records;
}
async function append(path, records, planSha256, event) {
  const body = { planSha256, previous: records.at(-1)?.hash ?? "", ...event };
  const record = { ...body, hash: digest(json(body)) };
  const file = await open(path, "a", 0o600);
  try { await file.writeFile(`${json(record)}\n`, "utf8"); await file.sync(); }
  finally { await file.close(); }
  records.push(record);
}
const feesFrom = (f) => Object.fromEntries(Object.entries(f).map(([n, v]) => [n, BigInt(v)]));
async function sdkCalldata(account, chain, read, creates, nonce, gas, fees) {
  let captured;
  const unsignedAccount = { ...account, signTransaction: async (r) => { captured = r; throw new Error("Unsigned SDK capture complete"); } };
  const wallet = createWalletClient({ account: unsignedAccount, chain, transport: custom({ request: read }, { retryCount: 0 }) });
  try { await wallet.executeBatch({ creates }, { nonce, gas, ...fees }); }
  catch (e) { if (!captured) throw e; }
  check(captured?.data && sameAddress(captured.to, NATIVE) && captured.nonce === nonce, "SDK capture did not match native create intent");
  return captured.data;
}

export async function prepareImport(options) {
  const { account, chain, request, rows, jobId, batchSize, planPath, journalPath, gasCeiling, maxTotalCost, fees } = options;
  return withCustody(account, chain, async (custodyPort) => {
    check(typeof jobId === "string" && jobId.length > 0, "Job ID required");
    check(Number.isSafeInteger(batchSize) && batchSize > 0 && Array.isArray(rows) && rows.length > 0, "Nonempty rows and positive batch size required");
    check(typeof gasCeiling === "bigint" && gasCeiling > 0n && typeof maxTotalCost === "bigint" && maxTotalCost > 0n, "Approved gas and spend caps required");
    const frozen = rows.map(freezeRow);
    check(new Set(frozen.map((r) => r.id)).size === frozen.length, "Duplicate row IDs");
    const names = Object.keys(fees ?? {}).sort().join(",");
    check(names === "gasPrice" || names === "maxFeePerGas,maxPriorityFeePerGas", "Choose one fee style");
    check(Object.values(fees).every((v) => typeof v === "bigint" && v >= 0n), "Invalid fees");
    const feeCap = fees.gasPrice ?? fees.maxFeePerGas;
    check(feeCap > 0n && (fees.maxPriorityFeePerGas ?? 0n) <= feeCap, "Invalid fee cap");
    const { reader, read } = clients(account, chain, request);
    check(await reader.getChainId() === chain.id, "Provider chain mismatch");
    const genesis = await reader.getBlock({ blockNumber: 0n });
    check(/^0x[0-9a-fA-F]{64}$/.test(genesis.hash), "Missing genesis identity");
    const latest = await reader.getTransactionCount({ address: account.address, blockTag: "latest" });
    const pending = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
    check(latest === pending, "Resolve existing pending transactions first");
    const startBlock = await reader.getBlockNumber({ cacheTime: 0 });
    const predicted = await reader.predictEntityKeys({ owner: account.address, salts: frozen.map((r) => BigInt(r.salt)) });
    frozen.forEach((r, i) => { r.expectedKey = predicted[i].key; });
    const batches = [];
    let totalCap = 0n;
    for (let start = 0; start < frozen.length; start += batchSize) {
      const index = batches.length, slice = frozen.slice(start, start + batchSize), nonce = latest + index;
      check(Number.isSafeInteger(nonce), "Nonce exceeds safe integer range");
      const creates = slice.map(hydrate);
      const input = await sdkCalldata(account, chain, read, creates, nonce, gasCeiling, fees);
      const estimate = await reader.estimateGas({ account: account.address, to: NATIVE, data: input, ...fees });
      const gas = (estimate * 125n + 99n) / 100n;
      check(gas <= gasCeiling, "Estimated gas exceeds approved ceiling");
      totalCap += gas * feeCap;
      batches.push({ index, nonce, gas: gas.toString(), input, rows: slice });
    }
    check(totalCap <= maxTotalCost && await reader.getBalance({ address: account.address }) >= totalCap, "Insufficient balance or approved budget");
    const plan = { schema: 1, jobId, chainId: chain.id, genesisHash: genesis.hash, account: account.address.toLowerCase(), custodyPort,
      startBlock: startBlock.toString(), firstNonce: latest, fees: JSON.parse(json(fees)), maxTotalCost: maxTotalCost.toString(), batches };
    const text = `${json(plan)}\n`, planSha256 = digest(text);
    await createFile(planPath, text);
    const header = { planSha256, previous: "", state: "initialized" };
    await createFile(journalPath, `${json({ ...header, hash: digest(json(header)) })}\n`);
    return { planSha256, batches: batches.length, maximumCost: totalCap.toString() };
  });
}

async function authenticateRaw(raw, plan, batch) {
  const tx = parseTransaction(raw);
  check(sameAddress(await recoverTransactionAddress({ serializedTransaction: raw }), plan.account), "Signed sender mismatch");
  check(tx.chainId === plan.chainId && tx.nonce === batch.nonce && sameAddress(tx.to, NATIVE)
    && (tx.value ?? 0n) === 0n && tx.data === batch.input && tx.gas === BigInt(batch.gas), "Signed transaction differs from plan");
  const legacy = plan.fees.gasPrice !== undefined;
  check(legacy ? tx.type === "legacy" && tx.gasPrice === BigInt(plan.fees.gasPrice)
    : tx.type === "eip1559" && tx.maxFeePerGas === BigInt(plan.fees.maxFeePerGas)
      && tx.maxPriorityFeePerGas === BigInt(plan.fees.maxPriorityFeePerGas), "Signed fees differ from plan");
  check(!tx.accessList?.length && !tx.authorizationList?.length && !tx.blobVersionedHashes?.length, "Unexpected transaction extensions");
  const decoded = decodeFunctionData({ abi: EXECUTE, data: tx.data });
  check(decoded.functionName === "execute" && decoded.args[0].length === batch.rows.length
    && decoded.args[0].every((op) => op.operation === 1), "Only the planned creates are admitted");
  return keccak256(raw);
}
async function authenticateReceipt(reader, plan, batch, captured) {
  check(captured.nonce === batch.nonce, "Captured nonce differs from plan");
  check(await authenticateRaw(captured.raw, plan, batch) === captured.txHash, "Captured hash mismatch");
  const tx = await reader.getTransaction({ hash: captured.txHash });
  check(tx.hash === captured.txHash && sameAddress(tx.from, plan.account) && sameAddress(tx.to, NATIVE)
    && tx.nonce === batch.nonce && tx.input === batch.input && tx.value === 0n
    && tx.gas === BigInt(batch.gas) && tx.chainId === plan.chainId, "Provider transaction differs from signed intent");
  check(plan.fees.gasPrice !== undefined ? tx.gasPrice === BigInt(plan.fees.gasPrice)
    : tx.maxFeePerGas === BigInt(plan.fees.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(plan.fees.maxPriorityFeePerGas), "Provider fee fields differ");
  const receipt = await reader.getTransactionReceipt({ hash: captured.txHash });
  check(receipt.status === "success" && receipt.transactionHash === captured.txHash
    && sameAddress(receipt.from, plan.account) && sameAddress(receipt.to, NATIVE)
    && /^0x[0-9a-fA-F]{64}$/.test(receipt.blockHash) && receipt.blockNumber >= BigInt(plan.startBlock)
    && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber
    && tx.transactionIndex === receipt.transactionIndex, "Receipt does not authenticate a successful inclusion");
  const feeCap = BigInt(plan.fees.gasPrice ?? plan.fees.maxFeePerGas);
  check(receipt.gasUsed >= 0n && receipt.gasUsed <= BigInt(batch.gas)
    && receipt.effectiveGasPrice >= 0n && receipt.effectiveGasPrice <= feeCap, "Receipt gas or price exceeds signed intent");
  const block = await reader.getBlock({ blockNumber: receipt.blockNumber });
  check(block.hash === receipt.blockHash && block.transactions.includes(captured.txHash), "Receipt block is no longer canonical");
  const nativeLogs = receipt.logs.filter((l) => sameAddress(l.address, NATIVE));
  check(nativeLogs.length === batch.rows.length, "Unexpected native event count");
  let previousIndex = -1;
  const keys = nativeLogs.map((log, i) => {
    check(log.transactionHash === captured.txHash && log.blockHash === receipt.blockHash && !log.removed
      && log.logIndex > previousIndex, "Event provenance/order mismatch");
    previousIndex = log.logIndex;
    const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data, topics: log.topics });
    const row = batch.rows[i];
    check(event.eventName === "EntityCreated" && sameAddress(event.args.owner, plan.account)
      && event.args.entityKey === row.expectedKey && event.args.expiresAt === BigInt(row.expiresAt)
      && event.args.creationFlags === ((row.flags.readonly ? 1 : 0) | (row.flags.permissionlessExtension ? 2 : 0)), "Created key/order/flags/expiry mismatch");
    return event.args.entityKey;
  });
  const snapshot = await reader.getBlockNumber({ cacheTime: 0 });
  check(snapshot >= receipt.blockNumber, "Readback provider is behind the receipt");
  for (let i = 0; i < keys.length; i++) {
    const row = batch.rows[i];
    const page = await reader.select("*").where(eq("$key", key(keys[i]))).atBlock(snapshot).limit(1).fetch();
    const entity = page.entities[0];
    check(entity !== undefined, "Created entity is absent at the readback snapshot");
    check(entity.key === keys[i] && sameAddress(entity.creator, plan.account) && sameAddress(entity.owner, plan.account)
      && entity.createdAt === receipt.blockNumber && entity.expiresAt === BigInt(row.expiresAt)
      && entity.contentType === row.contentType && bytesToHex(entity.payload) === row.payloadHex
      && entity.creationFlags.readonly === row.flags.readonly
      && entity.creationFlags.permissionlessExtension === row.flags.permissionlessExtension, "Entity readback mismatch");
    const expected = Object.entries(row.attributes).map(([n, v]) => [n, canonicalValue(typed(v))]).sort();
    const actual = Object.entries(entity.attributes).map(([n, v]) => [n, canonicalValue(v)]).sort();
    check(json(actual) === json(expected), "Typed attributes/order mismatch");
  }
  return { keys, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber.toString() };
}

export async function runImport({ account, chain, request, planPath, journalPath, planSha256 }) {
  return withCustody(account, chain, async (custodyPort) => {
    const text = await readFile(planPath, "utf8");
    check(digest(text) === planSha256, "Plan tampered or wrong trusted job hash");
    const plan = JSON.parse(text), records = await loadJournal(journalPath, planSha256);
    check(plan.schema === 1 && plan.chainId === chain.id && sameAddress(plan.account, account.address)
      && plan.custodyPort === custodyPort && Array.isArray(plan.batches), "Plan account/chain/custody mismatch");
    const { reader, read } = clients(account, chain, request);
    check(await reader.getChainId() === plan.chainId, "Provider chain mismatch");
    check((await reader.getBlock({ blockNumber: 0n })).hash === plan.genesisHash, "Chain genesis changed; this plan belongs to another network epoch");
    for (const batch of plan.batches) {
      check(batch.index === plan.batches.indexOf(batch) && batch.nonce === plan.firstNonce + batch.index, "Unstable batch numbering");
      const history = records.filter((r) => r.index === batch.index);
      check(history.every((r) => ["prepared", "submitting", "uncertain", "confirmed"].includes(r.state))
        && history.filter((r) => r.state === "submitting").length <= 1
        && history.filter((r) => r.state === "confirmed").length <= 1, "Invalid batch journal transitions");
      let captured = history.find((r) => r.state === "submitting");
      const confirmed = history.find((r) => r.state === "confirmed");
      if (captured) {
        const verified = await authenticateReceipt(reader, plan, batch, captured);
        if (confirmed) check(json(confirmed.verified) === json(verified), "Confirmed checkpoint differs from current authenticated inclusion");
        else await append(journalPath, records, planSha256, { index: batch.index, state: "confirmed", txHash: captured.txHash, verified });
        continue;
      }
      check(!confirmed && !history.some((r) => r.state === "uncertain"), "Missing durable submission record; reconcile first");
      const nonce = await reader.getTransactionCount({ address: account.address, blockTag: "latest" });
      const pending = await reader.getTransactionCount({ address: account.address, blockTag: "pending" });
      check(nonce === batch.nonce && pending === batch.nonce, "Account nonce changed; do not create a replacement");
      const fees = feesFrom(plan.fees), gas = BigInt(batch.gas);
      check(await reader.getBalance({ address: account.address }) >= gas * (fees.gasPrice ?? fees.maxFeePerGas), "Insufficient balance before submission");
      const creates = batch.rows.map(hydrate);
      check(await sdkCalldata(account, chain, read, creates, batch.nonce, gas, fees) === batch.input, "Current SDK encoding differs from frozen plan");
      check(await reader.estimateGas({ account: account.address, to: NATIVE, data: batch.input, ...fees }) <= gas, "Current estimate exceeds frozen gas");
      await append(journalPath, records, planSha256, { index: batch.index, state: "prepared" });
      const guarded = async (r) => {
        if (r.method !== "eth_sendRawTransaction") return read(r);
        check(!captured && r.params?.length === 1, "Duplicate send or malformed submission refused");
        const raw = r.params[0], txHash = await authenticateRaw(raw, plan, batch);
        const record = { index: batch.index, state: "submitting", nonce: batch.nonce, txHash, raw };
        await append(journalPath, records, planSha256, record);
        captured = record; // This assignment occurs only after the durable save.
        const acknowledged = await request(r);
        check(acknowledged === txHash, "Provider acknowledged another hash");
        return txHash;
      };
      const wallet = createWalletClient({ account, chain, transport: custom({ request: guarded }, { retryCount: 0 }) });
      try {
        const result = await wallet.executeBatch({ creates }, { nonce: batch.nonce, gas, ...fees });
        check(captured && result.txHash === captured.txHash && json(result.createdEntities) === json(batch.rows.map((r) => r.expectedKey)), "SDK result differs from planned key order");
      } catch (e) {
        // Phase evidence decides recovery, not instanceof or the SDK's message.
        if (captured) {
          await append(journalPath, records, planSha256, { index: batch.index, state: "uncertain", txHash: captured.txHash, errorName: errorName(e) });
          return { state: "needs_reconciliation", index: batch.index, txHash: captured.txHash };
        }
        throw new Error("Stopped before durable send admission; inspect journal before retrying", { cause: e });
      }
      const verified = await authenticateReceipt(reader, plan, batch, captured);
      await append(journalPath, records, planSha256, { index: batch.index, state: "confirmed", txHash: captured.txHash, verified });
    }
    return { state: "complete", planSha256, confirmedBatches: plan.batches.length };
  });
}
```

`executeBatch` itself does not expose a pre-broadcast callback. This example supplies a transport wrapper and accepts local signing only, so its first network mutation is the guarded raw send. It refuses `eth_sendTransaction`, wallet signing RPCs, and unknown provider methods. Keep provider request deadlines bounded and retries disabled in the supplied adapter too. A receipt timeout returns a known hash; an exception while persisting a post-send checkpoint may propagate, but the earlier submitting record remains the restart source. No other batch is admitted after either failure.

The plan hash is a trusted input, not an authenticity claim made by an editable JSON file. The journal hash chain detects torn or inconsistent entries; it is not a substitute for filesystem access control or a trusted external job entry. Do not edit a plan, clear a journal, select a new nonce, or start a second job to escape an uncertain result. A nonce scan from the captured `startBlock` is a separate operator recovery path when adopting an older importer that never captured a hash. Authenticate the recovered sender, nonce, native address, input, receipt, and entity order before saving confirmation. A consumed nonce alone does not prove that your intended create succeeded.

Sources: [SDK 0.8.1 batch encoding, send and receipt handling](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts), [SDK 0.8.1 executeBatch](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/wallet/executeBatch.ts), [native operation ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/operations.ts), [entity key prediction](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/actions/public/predictEntityKeys.ts), and [TxParams](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/txParams.ts). The helper is tested with SDK 0.8.1; the declared skill range does not certify future releases.
