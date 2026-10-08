# Current raw JSON-RPC

Protocol basis: SDK 0.8.1 and official Tiramisu docs, source checked 2026-10-08 with earlier live responses retained separately. RPC: `https://rpc.tiramisu.db-chain.testnet.arkiv.network`; chain ID `7738577` (`0x7614d1`). Check a Python/Rust client's actual wire encoding against these sources; language support does not establish compatibility with this protocol.

## Query shape and options

`arkiv_query` takes `[expression, options]`. The options whitelist is `atBlock`, `select`, `limit`, `cursor`. Query `atBlock` and the documented `limit` are hex quantities; max page size is 200. The node also accepted the published numeric limit 100, but hex matches the typed SDK wire contract.

`select` is a flat projection: `key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `contentType`, `payload`, `attributeSchema`, `attributes`. `attributes` can be true or a map of attribute names to booleans. Array-form selections are an older SDK style and are rejected on this wire. The result has `data`, hex `blockNumber` and optional `cursor`; missing cursor means completion. Omitting `limit` returns at most 100 rows per page, with a cursor when more remain.

Raw attributes are an array of `{name, type, value}`, not the SDK's typed attribute map. A projected row can look like this:

```json
{"key":"0x1212121212121212121212121212121212121212121212121212121212121212","owner":"0x1111111111111111111111111111111111111111","attributes":[{"name":"price_minor","type":"u256","value":"0xd3c21bcecceda1000000"},{"name":"active","type":"bool","value":true}]}
```

| Declared type or field | Raw JSON encoding | Decode |
| --- | --- | --- |
| `u64`, `u256` | `0x` quantity string | Exact integer, such as `BigInt(value)`; never a JavaScript number for large values. |
| `i32` | JSON number | Signed 32-bit integer. |
| `bool` | JSON boolean | Preserve the boolean. |
| `dec` | Decimal string | Exact decimal with up to 18 fractional digits. |
| `str` | String | Preserve its contents. |
| `bytes32`, `key`, payload/system `bytes` | `0x` data string | Preserve fixed width for keys/bytes32; decode payload bytes explicitly. |
| `addr`, `owner`, `creator` | 20-byte address string; Tiramisu returns lowercase | Compare addresses case-insensitively; SDK decoding normalizes checksum casing. |
| `createdAt`, `updatedAt`, `expiresAt`, result `blockNumber` | `0x` quantity string | Exact block number, separate from an application timestamp. |

Dispatch on the declared type, not the apparent size of a value. The SDK also tolerates decimal integer strings; that tolerance does not change the current node's encoding.

Keep the exact expression, block and selection when following the opaque cursor. Raw `*` is accepted, but application examples below use an explicit creator scope. The current node rejects unknown query options with `-32602`; it rejects the SDK-exported `!=`, `EXISTS` and `TYPEOF` expressions with `-32002`.

This server-side standard-library Python example reads **one page**. Set `ARKIV_CREATOR` to a creator known to your application; it validates the address format, obtains a snapshot and keeps the query scoped. An optional local `ARKIV_ACCESS_KEY` is sent only to the fixed official RPC below; redirects are refused. It uses a User-Agent, timeout and no retry. A valid empty page is still a valid response.

```python
import json
import os
import re
import urllib.error
import urllib.request

RPC = 'https://rpc.tiramisu.db-chain.testnet.arkiv.network'
creator = os.environ['ARKIV_CREATOR'].lower()
if not re.fullmatch(r'0x[0-9a-f]{40}', creator):
    raise ValueError('ARKIV_CREATOR must be a 20-byte address')

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise RuntimeError('RPC redirect refused; keep the access key on its intended origin')

opener = urllib.request.build_opener(NoRedirect())
headers = {'Content-Type': 'application/json', 'User-Agent': 'arkiv-query-example/0.8.1'}
if os.environ.get('ARKIV_ACCESS_KEY'):
    headers['X-API-KEY'] = os.environ['ARKIV_ACCESS_KEY']

def rpc(method, params):
    request = urllib.request.Request(
        RPC,
        data=json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode(),
        headers=headers,
    )
    try:
        with opener.open(request, timeout=8) as response:
            body = json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == 429 or error.headers.get('Retry-After'):
            raise RuntimeError('Rate limited; defer according to provider headers') from error
        raise
    if 'error' in body:
        raise RuntimeError(body['error'])
    return body['result']

snapshot = rpc('eth_blockNumber', [])
expression = f"$creator = addr({creator}) AND entity_type = str('nft')"
page = rpc('arkiv_query', [expression, {
    'atBlock': snapshot,
    'select': {'key': True, 'attributes': True},
    'limit': '0x64',
}])
print({'blockNumber': page['blockNumber'], 'entities': page['data'], 'cursor': page.get('cursor')})
```

For a complete walk, append each page and follow the returned cursor with the same request. Apply a total page budget. A `-32005` restart must discard previous pages; `-32006` must preserve an explicit historical request. The SDK example in the main skill implements that policy.

## Filtered count and historical entity

The SDK's empty-param count is chain-wide. Raw filtered count is an object in the params array:

```json
{"jsonrpc":"2.0","id":2,"method":"arkiv_getEntityCount","params":[{"query":"$creator = addr(0x1111111111111111111111111111111111111111) AND entity_type = str('nft')"}]}
```

The optional count `block` field is a JSON number. A bare query string is not this contract; a `filter` field can be ignored. The result is a JSON number. Retained Tiramisu responses from 2026-10-07 verify filtered counts of 0 before creation and 230 afterward over a short historical range. Long-range retention remains provider-dependent. SDK 0.8.1's typed count schema allows only empty params; use an explicit narrow raw-request boundary, as in the main skill, for this verified filtered shape.

Raw entity lookup uses a JSON-number block, while query `atBlock` uses hex:

```json
{"jsonrpc":"2.0","id":3,"method":"arkiv_getEntity","params":["0x1212121212121212121212121212121212121212121212121212121212121212",4096]}
```

Replace the illustrative key/block with the requested values. `arkiv_getEntity` returns all entity fields or null and has no select argument; the current node ignores extra params instead of applying a projection. Use `arkiv_query` with `$key = key(...)` and `select` for a projection. A null read does not establish erasure, retained history, or whether an entity ever existed. Keep u64 values exact; JavaScript JSON numbers additionally need safe-integer bounds. Do not serialize a bigint directly to JSON.

Query rejection codes are `-32001` parse, `-32002` type/operator, `-32003` literal, `-32004` complexity limits, `-32005` cursor and `-32006` block. `-32602` is invalid params. HTTP 429 with rate-limit headers is a service response, distinct from a successful empty `data` array. HTTP 401 `INVALID_KEY` was verified with an invalid placeholder access key; no real secret was needed.

## Native mutation wire contract

This section documents the protocol for clients that cannot use the SDK; generating or estimating calldata does not authorize broadcasting it. Normal entity mutations call the native system address `0x4400000000000000000000000000000000000044`, with transaction value zero and ABI `execute((uint8 operation, bytes operationData)[] ops) returns (bytes32[] keys)`. This is a native operation entrypoint; it does not imply user EVM contract deployment.

Operation tags are create 1, patch 2, extend 3, transfer 4, delete 5. Each operationData is ABI encoding of its tagged struct:

| Operation | Struct |
| --- | --- |
| Create | `uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, attributes[]` |
| Patch | `bytes32 entityKey, mutations[]` |
| Extend | `bytes32 entityKey, uint64 expiresAt, uint64 minLifetime` |
| Transfer | `bytes32 entityKey, address newOwner` |
| Delete | `bytes32 entityKey` |

Each attribute/mutation is `(bytes32 name, uint8 typeId, bytes value)`, sorted ascending by the encoded bytes32 name. Names are left-aligned UTF-8, null-padded to 32 bytes. Type IDs: bool 1, i32 2, u64 3, u256 4, dec 5, bytes32 6, system bytes 7, str 8, addr 9, key 10. Tombstone type 0 has empty bytes and is legal only in patch mutations. Create includes `$payload` (bytes) and `$contentType` (str).

Word types use 32-byte values: integer/address words right-aligned, signed i32/decimal sign-extended, decimal scaled by 10^18. String and payload bytes are variable-length raw bytes. A 32-byte name is not the query literal string, and its padding is different from a word value.

This pure encoder creates an illustrative NFT with a one-hour nominal lifetime (1800 blocks). It returns calldata and an estimate request; it sends neither. Use the sender and expiry policy actually authorized for the application.

```typescript
import { encodeAbiParameters, encodeFunctionData, parseAbi, parseAbiParameters, toHex, type Address } from 'viem';

export const executeAbi = parseAbi([
  'function execute((uint8 operation, bytes operationData)[] ops) external returns (bytes32[] keys)',
]);

export function referenceCreateCalldata() {
  const attributes = [
    { name: toHex('$payload', { size: 32 }), typeId: 7, value: '0x' as const },
    { name: toHex('$contentType', { size: 32 }), typeId: 8, value: toHex('application/octet-stream') },
    { name: toHex('project', { size: 32 }), typeId: 8, value: toHex('example_nfts') },
    { name: toHex('entity_type', { size: 32 }), typeId: 8, value: toHex('nft') },
    { name: toHex('created_at', { size: 32 }), typeId: 3, value: toHex(1700000000000n, { size: 32 }) },
  ].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const operationData = encodeAbiParameters(parseAbiParameters(
    '(uint128 salt, uint64 expiresAt, uint64 minLifetime, uint8 creationFlags, (bytes32 name, uint8 typeId, bytes value)[] attributes)',
  ), [{ salt: 4660n, expiresAt: 0n, minLifetime: 1800n, creationFlags: 0, attributes }]);
  return encodeFunctionData({ abi: executeAbi, functionName: 'execute', args: [[{ operation: 1, operationData }]] });
}

export function referenceEstimateRequest(from: Address) {
  return { jsonrpc: '2.0', id: 4, method: 'eth_estimateGas', params: [{
    from, to: '0x4400000000000000000000000000000000000044', value: '0x0', data: referenceCreateCalldata(),
  }] };
}

export const nativeEventAbi = parseAbi([
  'event EntityCreated(bytes32 indexed entityKey, address indexed owner, uint64 expiresAt, uint8 creationFlags)',
  'event EntityPatched(bytes32 indexed entityKey, address indexed owner)',
  'event ExpiryExtended(bytes32 indexed entityKey, address indexed owner, uint64 expiresAt)',
  'event OwnershipTransferred(bytes32 indexed entityKey, address indexed previousOwner, address indexed newOwner)',
  'event EntityDeleted(bytes32 indexed entityKey, address indexed owner)',
]);
```

`eth_estimateGas` validates the exact sender/calldata against current state without committing it. Provider balance and fee rules can still reject an estimate; do not strip fields to manufacture success. A passing estimate is not a persisted write, a concurrency reservation, HTTP submission-size certification or a gas/fee guarantee for later submission.

Encoding test vectors:

```json
{"executeSelector":"0x49650044","i32MinusOne":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","u64Lifetime1800":"0x0000000000000000000000000000000000000000000000000000000000000708","strMakerApostropheS":"0x6d616b65722773"}
```

The five event signatures above match SDK 0.8.1. Decode a receipt with their indexed topics and data fields; logs do not contain payload or attributes. Read the entity at an appropriate retained snapshot to reconstruct content. There is no event for Entity Expiration. Reconcile transaction receipt/state before deciding whether to retry a mutation.

## Sources

SDK 0.8.1: [RPC schema](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/types/rpcSchema.ts), [operation ABI](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/operations.ts), [attribute encoding](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/codec.ts), [system cells and ordering](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/attr/attributes.ts), [five events](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/entity/events.ts).

Official [raw queries](https://docs.arkiv.network/json-rpc/querying-data/) and [native mutations](https://docs.arkiv.network/json-rpc/mutating-entities/). Prior live probes validate quoted/unquoted decimals, booleans, unsupported operators, raw extra system fields, filtered count shape, numeric versus hex historical arguments, errors and four-page SDK pagination. New examples are typechecked/encoded against the SDK and deterministic fixtures; no mutation was broadcast.
