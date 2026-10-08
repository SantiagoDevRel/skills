# Owned checkpoint mirror

This example belongs to its caller: every Map and journal entry is created here. `serialize`/`restore` preserve the retained rollback window across restarts. A production storage adapter must commit row changes, replay identities, journal and checkpoint together, scoped to the indexer's projection ID. A live consumer independently verifies chain/genesis/scope identity and checkpoint hashes on restart.

The adapter materializes one trusted creator's marketplace rows at a **block-end snapshot**. It uses a key-filtered SDK query to avoid substituting head for the historical block. A scoped empty page removes only that key's local projection row; transport/query failures propagate.

```typescript
import { createPublicClient, ENTITY_EVENTS_ABI } from '@arkiv-network/sdk';
import { key, str } from '@arkiv-network/sdk/attr';
import { eq } from '@arkiv-network/sdk/query';
import { bytesToHex, hexToBytes, decodeEventLog, type Address, type Hex } from 'viem';

type Public = ReturnType<typeof createPublicClient>;
export const nativeAddress: Address = '0x4400000000000000000000000000000000000044';
export type Header = { number: bigint; hash: Hex; parentHash: Hex };
export type Scope = { creator: Address; project: string; type: string };
export type MirrorRow = {
  key: Hex; creator: Address; owner: Address; expires_at: bigint;
  payload: Uint8Array; attributes: Record<string, unknown>;
};
export type PositionedLog = {
  address: Address; blockNumber: bigint; blockHash: Hex;
  transactionHash: Hex; logIndex: number; entityKey: Hex;
  eventName?: (typeof ENTITY_EVENTS_ABI)[number]['name']; owner?: Address;
};
export type BlockInput = { header: Header; logs: readonly PositionedLog[] };

export async function readNativeBlock(client: Public, number: bigint): Promise<BlockInput> {
  const block = await client.getBlock({ blockNumber: number });
  if (!block.hash) throw new Error('Block hash unavailable');
  // Bind even an empty log result to this header, rather than a second provider view of number.
  const logs = await client.getLogs({ address: nativeAddress, events: ENTITY_EVENTS_ABI,
    blockHash: block.hash, strict: false });
  const positioned: PositionedLog[] = [];
  for (const log of logs) {
    if (log.removed || log.blockNumber === null || log.blockHash === null ||
        log.transactionHash === null || log.logIndex === null) {
      throw new Error('Canonical log position unavailable');
    }
    // Keep malformed known-topic logs visible, then fail strict decoding instead of skipping them.
    const event = decodeEventLog({ abi: ENTITY_EVENTS_ABI, data: log.data,
      topics: log.topics as [Hex, ...Hex[]] });
    positioned.push({ address: log.address, blockNumber: log.blockNumber, blockHash: log.blockHash,
      transactionHash: log.transactionHash, logIndex: log.logIndex, entityKey: event.args.entityKey,
      eventName: event.eventName, ...('owner' in event.args ? { owner: event.args.owner } : {}) });
  }
  return { header: { number: block.number, hash: block.hash, parentHash: block.parentHash }, logs: positioned };
}

export async function readMarketplaceRowAt(
  client: Public, scope: Scope, entityKey: Hex, block: bigint,
): Promise<MirrorRow | null> {
  const page = await client.select({ key: true, owner: true, creator: true,
    expiresAt: true, payload: true, attributes: true })
    .where(eq('$key', key(entityKey)), eq('project', str(scope.project)),
      eq('entity_type', str(scope.type)))
    .createdBy(scope.creator).atBlock(block).limit(1).fetch();
  if (page.blockNumber !== block) throw new Error('Snapshot block mismatch');
  const row = page.entities[0];
  return row ? { key: row.key, creator: row.creator, owner: row.owner,
    expires_at: row.expiresAt, payload: row.payload, attributes: row.attributes } : null;
}

type JournalEntry = { header: Header; rows: Map<Hex, MirrorRow>; eventIds: Set<string> };

// Every value is tagged, including objects: user attributes cannot collide with bigint/byte tags.
function pack(value: unknown, depth = 0): unknown {
  if (depth > 64) throw new Error('Projection state nesting limit');
  if (value === null) return ['null'];
  if (typeof value === 'bigint') return ['bigint', value.toString()];
  if (value instanceof Uint8Array) return ['bytes', bytesToHex(value)];
  if (['string', 'boolean', 'number'].includes(typeof value)) {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Nonfinite projection number');
    return [typeof value, value];
  }
  if (Array.isArray(value)) return ['array', value.map((item) => pack(item, depth + 1))];
  if (value && Object.getPrototypeOf(value) === Object.prototype) {
    return ['object', Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([name, item]) => [name, pack(item, depth + 1)])];
  }
  throw new Error('Unsupported projection state value');
}

function unpack(value: unknown, depth = 0): unknown {
  if (depth > 64 || !Array.isArray(value)) throw new Error('Corrupt projection state');
  const [tag, data] = value;
  if (tag === 'null' && value.length === 1) return null;
  if (value.length !== 2) throw new Error('Corrupt projection state');
  if (tag === 'string' && typeof data === 'string') return data;
  if (tag === 'boolean' && typeof data === 'boolean') return data;
  if (tag === 'number' && typeof data === 'number' && Number.isFinite(data)) return data;
  if (tag === 'bigint' && typeof data === 'string' && /^(0|-?[1-9][0-9]*)$/.test(data)) return BigInt(data);
  if (tag === 'bytes' && typeof data === 'string' && /^0x(?:[0-9a-f]{2})*$/i.test(data)) return hexToBytes(data as Hex);
  if (tag === 'array' && Array.isArray(data)) return data.map((item) => unpack(item, depth + 1));
  if (tag === 'object' && Array.isArray(data)) {
    const names = new Set<string>();
    return Object.fromEntries(data.map((entry: unknown) => {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || names.has(entry[0])) {
        throw new Error('Corrupt projection state');
      }
      names.add(entry[0]); return [entry[0], unpack(entry[1], depth + 1)];
    }));
  }
  throw new Error('Corrupt projection state');
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('Corrupt projection state');
  }
  return value as Record<string, unknown>;
}
function hash(value: unknown): value is Hex { return typeof value === 'string' && /^0x[0-9a-f]{64}$/i.test(value); }
function address(value: unknown): value is Address { return typeof value === 'string' && /^0x[0-9a-f]{40}$/i.test(value); }
function checkedHeader(value: unknown): Header {
  const h = record(value);
  if (typeof h.number !== 'bigint' || h.number < 0n || !hash(h.hash) || !hash(h.parentHash)) {
    throw new Error('Corrupt projection header');
  }
  return { number: h.number, hash: h.hash, parentHash: h.parentHash };
}
function checkedRows(value: unknown, creator: Address, number: bigint): Map<Hex, MirrorRow> {
  if (!Array.isArray(value)) throw new Error('Corrupt projection rows');
  const rows = new Map<Hex, MirrorRow>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || !hash(entry[0])) throw new Error('Corrupt projection rows');
    const row = record(entry[1]);
    if (row.key !== entry[0] || rows.has(entry[0]) || !address(row.creator) || !address(row.owner) ||
        row.creator.toLowerCase() !== creator.toLowerCase() || typeof row.expires_at !== 'bigint' ||
        row.expires_at <= number || row.expires_at > (1n << 64n) - 1n || !(row.payload instanceof Uint8Array)) {
      throw new Error('Corrupt projection row');
    }
    record(row.attributes);
    rows.set(entry[0], structuredClone(row) as MirrorRow);
  }
  return rows;
}

export class OwnedMirror {
  readonly identity: string;
  readonly creator: Address;
  readonly journalBlocks: number;
  rows: Map<Hex, MirrorRow>;
  checkpoint: Header;
  private journal: Map<bigint, JournalEntry>;

  constructor(identity: string, creator: Address, baseline: Header, rows: readonly MirrorRow[] = [], journalBlocks = 16) {
    if (!identity || !address(creator)) throw new Error('Invalid projection identity or creator');
    if (!Number.isSafeInteger(journalBlocks) || journalBlocks < 2) throw new Error('Invalid journal window');
    checkedHeader(baseline);
    this.identity = identity; this.creator = creator; this.journalBlocks = journalBlocks;
    this.rows = checkedRows(rows.map((row) => [row.key, row]), creator, baseline.number);
    this.checkpoint = { ...baseline };
    this.journal = new Map([[baseline.number, { header: { ...baseline },
      rows: structuredClone(this.rows), eventIds: new Set() }]]);
  }

  assertCheckpoint(header: Header) {
    if (header.number !== this.checkpoint.number || header.hash !== this.checkpoint.hash) {
      throw new Error('Checkpoint hash mismatch');
    }
  }

  async applyBlock(identity: string, block: BlockInput, readAt: (key: Hex, number: bigint) => Promise<MirrorRow | null>,
    verifyCanonical?: (header: Header) => Promise<void>) {
    if (identity !== this.identity) throw new Error('Chain identity changed; start a new projection generation');
    const { header } = block;
    const known = this.journal.get(header.number);
    if (known?.header.hash === header.hash && header.number <= this.checkpoint.number) return false;
    if (!known && header.number <= this.checkpoint.number) throw new Error('Block older than retained journal');
    if (header.number !== this.checkpoint.number + 1n || header.parentHash !== this.checkpoint.hash) {
      throw new Error('Noncontiguous block or parent hash mismatch');
    }
    const staged = structuredClone(this.rows);
    const eventIds = new Set<string>();
    const touched = new Set<Hex>();
    for (const log of [...block.logs].sort((a, b) => a.logIndex - b.logIndex)) {
      if (log.address.toLowerCase() !== nativeAddress) continue;
      if (log.blockNumber !== header.number || log.blockHash !== header.hash ||
          !Number.isInteger(log.logIndex) || log.logIndex < 0) {
        throw new Error('Log does not belong to the canonical block');
      }
      const id = `${identity}:${header.hash}:${log.transactionHash}:${log.logIndex}`;
      if (eventIds.has(id)) continue;
      eventIds.add(id);
      // Unknown patches may bring a trusted creator's previously excluded key into scope.
      // Missing event metadata stays conservative (useful for externally decoded log adapters).
      if (staged.has(log.entityKey) || !log.eventName || log.eventName === 'EntityPatched' ||
          (log.eventName === 'EntityCreated' && (!log.owner || log.owner.toLowerCase() === this.creator.toLowerCase()))) {
        touched.add(log.entityKey);
      }
    }
    for (const entityKey of touched) {
      const row = await readAt(entityKey, header.number);
      if (row) {
        if (row.key !== entityKey || row.creator.toLowerCase() !== this.creator.toLowerCase()) {
          throw new Error('Snapshot row belongs to another creator');
        }
        staged.set(entityKey, structuredClone(row));
      } else staged.delete(entityKey); // Only the Map created by this projection.
    }
    for (const [entityKey, row] of staged) {
      if (row.expires_at <= header.number) staged.delete(entityKey);
    }
    // The live adapter below rechecks the header after all pinned reads, before any local commit.
    if (verifyCanonical) await verifyCanonical(header);
    // Across-block replay uses retained header hashes. eventIds are the per-block audit/dedup journal.
    // All reads/sweeps succeeded. Production adapters commit this state atomically.
    this.rows = staged; this.checkpoint = { ...header };
    this.journal.set(header.number, { header: { ...header }, rows: structuredClone(staged), eventIds });
    while (this.journal.size > this.journalBlocks) this.journal.delete(this.journal.keys().next().value!);
    return true;
  }

  serialize(): string {
    return JSON.stringify(pack({ version: 1, identity: this.identity, creator: this.creator,
      journalBlocks: this.journalBlocks, checkpoint: this.checkpoint, rows: [...this.rows],
      journal: [...this.journal.values()].map((entry) => ({ header: entry.header,
        rows: [...entry.rows], eventIds: [...entry.eventIds] })) }));
  }

  static restore(serialized: string, expectedIdentity: string, expectedCreator: Address): OwnedMirror {
    const state = record(unpack(JSON.parse(serialized)));
    if (state.version !== 1 || state.identity !== expectedIdentity || !address(state.creator) ||
        state.creator.toLowerCase() !== expectedCreator.toLowerCase()) throw new Error('Projection identity/schema mismatch');
    if (typeof state.journalBlocks !== 'number' || !Number.isSafeInteger(state.journalBlocks) || state.journalBlocks < 2 ||
        !Array.isArray(state.journal) || state.journal.length < 1 || state.journal.length > state.journalBlocks) {
      throw new Error('Corrupt projection journal');
    }
    const checkpoint = checkedHeader(state.checkpoint);
    const rows = checkedRows(state.rows, expectedCreator, checkpoint.number);
    const journal = new Map<bigint, JournalEntry>();
    let previous: Header | undefined;
    for (const raw of state.journal) {
      const entry = record(raw); const header = checkedHeader(entry.header);
      if (previous && (header.number !== previous.number + 1n || header.parentHash !== previous.hash)) {
        throw new Error('Corrupt projection journal continuity');
      }
      if (!Array.isArray(entry.eventIds) || entry.eventIds.some((id: unknown) => typeof id !== 'string' ||
          !id.startsWith(`${expectedIdentity}:${header.hash}:`) || !/0x[0-9a-f]{64}:[0-9]+$/i.test(id)) ||
          new Set(entry.eventIds).size !== entry.eventIds.length) throw new Error('Corrupt projection event identities');
      journal.set(header.number, { header, rows: checkedRows(entry.rows, expectedCreator, header.number),
        eventIds: new Set(entry.eventIds as string[]) }); previous = header;
    }
    const tail = journal.get(checkpoint.number);
    if (!tail || previous?.number !== checkpoint.number || tail.header.hash !== checkpoint.hash ||
        tail.header.parentHash !== checkpoint.parentHash || JSON.stringify(pack([...tail.rows])) !== JSON.stringify(pack([...rows]))) {
      throw new Error('Corrupt projection checkpoint tail');
    }
    const mirror = new OwnedMirror(expectedIdentity, expectedCreator, checkpoint, [...rows.values()], state.journalBlocks);
    mirror.journal = journal;
    return mirror;
  }

  async findAncestor(readHeader: (number: bigint) => Promise<Header>): Promise<Header> {
    for (const entry of [...this.journal.values()].reverse()) {
      const canonical = checkedHeader(await readHeader(entry.header.number)); // RPC failure propagates.
      if (canonical.number !== entry.header.number) throw new Error('Canonical header number mismatch');
      if (canonical.hash === entry.header.hash && canonical.parentHash === entry.header.parentHash) return canonical;
    }
    throw new Error('Ancestor outside retained projection journal');
  }

  rollbackTo(verifiedAncestor: Header) {
    const entry = this.journal.get(verifiedAncestor.number);
    if (!entry || entry.header.hash !== verifiedAncestor.hash) {
      throw new Error('Ancestor outside retained projection journal');
    }
    this.rows = structuredClone(entry.rows); this.checkpoint = { ...entry.header };
    for (const number of [...this.journal.keys()]) {
      if (number > verifiedAncestor.number) this.journal.delete(number);
    }
  }
}

export async function applyNativeBlock(client: Public, mirror: OwnedMirror, identity: string, number: bigint, scope: Scope) {
  if (scope.creator.toLowerCase() !== mirror.creator.toLowerCase()) throw new Error('Projection creator mismatch');
  const block = await readNativeBlock(client, number);
  return mirror.applyBlock(identity, block, (entityKey, atBlock) => readMarketplaceRowAt(client, scope, entityKey, atBlock),
    async (expected) => {
      const canonical = await client.getBlock({ blockNumber: expected.number });
      if (canonical.hash !== expected.hash || canonical.parentHash !== expected.parentHash) {
        throw new Error('Canonical header changed during projection read');
      }
    });
}
```

Create the baseline from an empty known starting block or a complete scoped query at a pinned snapshot; follow [the bounded pinned query walkthrough](../../arkiv-query/SKILL.md) and materialize the same fields as `readMarketplaceRowAt`. Re-read the baseline header after scanning. Set `identity` from independently fetched `await client.getChainId()`, the non-null hash of `await client.getBlock({ blockNumber: 0n })`, configured reset generation, `{ creator, project, type }` and projection schema version. Verify these inputs again before restoring. A reset that reuses genesis needs a separately configured generation identifier; a function argument alone does not verify chain identity.

For RPC processing, call `applyNativeBlock`: it binds logs to a block hash and rechecks the canonical header after staged row reads. `applyBlock` is the lower-level deterministic adapter; callers supplying their own live reader must supply the canonical-verification callback too. A reorg after the final check is still possible: recheck the committed checkpoint before the next block and on restart.

One worker owns this instance. Queue blocks serially; do not run `applyBlock` concurrently. The example performs no asynchronous database commit, external deletion or network write. Its journal keeps a configurable number of full row snapshots; budget their storage for the actual row/payload volume. It is a rollback window, not an unbounded historical archive.

To detect a reorganization, re-fetch the saved checkpoint header and call `assertCheckpoint`. On mismatch, call `findAncestor` with a canonical header reader, then pass the returned header to `rollbackTo`. RPC failures propagate instead of masquerading as a missing block. If no ancestor remains, bootstrap an isolated projection. Fetch hashes separately for SDK watcher callbacks because those callbacks omit them.

Persist the entire `serialize()` result, including retained row snapshots, event IDs and headers. It stores bigint as tagged decimal strings and bytes as tagged hex, preserving attribute types without interpreting attribute objects as codec instructions. Bound the file size before parsing and accept only state from this projection's trusted storage. On startup, `restore` validates schema/identity, row shape, journal continuity and the checkpoint/tail pair; corrupt state is an integrity error, separate from a verified network reorg. Re-read chain identity and the checkpoint before following new blocks.

For file storage, create a new generation file, flush it and atomically replace only the prior state file owned by this indexer; flush the directory where the platform supports it. A commit audit log may append the generation/checkpoint/hash after the state commit. On restart, compare its tail with the committed generation and reconcile an interrupted append before processing; do not treat two independent file writes as an atomic transaction. A transactional database can commit rows, journal, dedup identities and checkpoint together. A crash before commit reloads the previous complete state; a crash after commit reloads the complete new state.

The prefilter reads existing mirrored keys, trusted `EntityCreated` keys and **all unknown `EntityPatched` keys**: a patch may move a trusted publisher's entity into scope. It can skip foreign creates and unknown transfer/extension/delete events; logs with missing metadata remain conservative. For throughput, collect dirty keys over bounded ranges and query their OR expression once per block, with a complete pinned cursor scan. Batch at most 50 JSON-RPC calls on the observed Tiramisu endpoint and split log ranges on the documented capacity errors; keep empty-block expiry sweeps. Do not drop unknown patches to reduce RPC traffic.

Deletion or scope changes produce a null pinned row read. Expiration requires an empty-block sweep too. The final row read at a block coalesces all its operations; it does not reconstruct intermediate payload versions. A block read or row failure leaves the checkpoint, rows and journal unchanged.

SDK 0.8.1 sources: [native address](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/consts.ts), [event ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/events.ts), [watch context](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/events.ts), [query snapshot](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/query/engine.ts). The persistence/rollback policy is consumer guidance verified with deterministic fixtures, not an SDK service guarantee.
