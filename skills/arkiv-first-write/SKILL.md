---
name: arkiv-first-write
description: Set up @arkiv-network/sdk on a verified Arkiv testnet and make a first entity write with funding, safe key custody, explicit expiration, seed reconciliation and query read-back. Tiramisu is the default. Use for a first write, quickstart or minimal SDK example; use arkiv-app-integration for authenticated application endpoints.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: "tiramisu"
  verified: "2026-10-05"
---

# First Arkiv write

Use `arkiv` for orientation. This skill produces one verified entity, not a production signing API. Read `arkiv-write-safety` before bulk imports or recovery from an ambiguous submission.

## Prepare the project

Inspect the existing package manager and installed SDK declarations. Explain a dependency installation before running it. For a new npm project:

```bash
npm install @arkiv-network/sdk@^0.8.1 viem
```

Configure `ARKIV_PRIVATE_KEY` locally in a server-only environment. Never request its value in chat. Use a dedicated development EOA, not a production account. An access key, if needed, goes in a server-side `X-API-KEY` header; it does not fund transactions.

Announce **Tiramisu, chain 7738577**, and the proposed entity before sending. A live write spends test GLM: get authorization for that write or a bounded smoke-test budget. Check the balance and estimate the actual transaction; a positive balance alone does not establish enough gas. Use the [Hub faucet](https://hub.arkiv.network/faucet) without promising an amount or cooldown. If spending is not authorized, stop at preparation and estimation.

For another Arkiv chain, announce its verified name, chain ID and RPC instead. SDK 0.8.1 exports Tiramisu and localhost; an RPC URL alone does not change a client's chain. Build a viem `Chain` from verified network coordinates and pass it explicitly to the helper and the [dry run](references/estimate.md). Check funding on that chain. Never rename Tiramisu or invent an SDK chain export.

SDK 0.8.1 has no public create-estimator method. Use the guarded [dry run](references/estimate.md) with the same create parameters: it captures the SDK's gas estimate and blocks every broadcast. It is not a live write/read-back test.

## Create, reconcile a seed, and read back

The following server-only helper assumes the write has been authorized. Pass a locally loaded `LocalAccount` from viem's `privateKeyToAccount`; validate that the configured value is a 32-byte hex key without logging it. No environment secret is read at import time.

Use an exclusive writer for this creator while running the seed. Query-before-create prevents routine repeated runs; it is **not atomic uniqueness** across processes. A reset chain or expired seed means a new key, so rebuild references. This example makes its note readonly; its owner can still delete, transfer or extend it.

```typescript
import {
  createPublicClient, createWalletClient, EntityMutationError,
  ExpirationTime, jsonToPayload, type CreateEntityParameters,
} from "@arkiv-network/sdk";
import { key, u64 } from "@arkiv-network/sdk/attr";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http, type Chain, type LocalAccount } from "viem";

export function firstNoteParameters(): CreateEntityParameters {
  return {
    payload: jsonToPayload({ text: "Hello, Arkiv" }), contentType: "application/json",
    attributes: {
      project: "first_note", entity_type: "note", seed_id: "welcome_v1",
      created_at: u64(Date.now()),
    },
    expires: ExpirationTime.fromDays(1),
    flags: { readonly: true, permissionlessExtension: false },
  };
}

export async function ensureFirstNote(
  account: LocalAccount,
  rpcUrl: string = tiramisu.rpcUrls.default.http[0],
  chain: Chain = tiramisu,
) {
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl, { fetchOptions: { cache: "no-store" }, retryCount: 0 }),
  });
  const walletClient = createWalletClient({
    account, chain, transport: http(rpcUrl, { retryCount: 0 }),
  });
  if (await publicClient.getChainId() !== chain.id) throw new Error("Wrong chain");
  const expected = jsonToPayload({ text: "Hello, Arkiv" });
  const matches = (payload: Uint8Array) =>
    payload.length === expected.length && payload.every((value, i) => value === expected[i]);
  const prior = await publicClient
    .select({ key: true, payload: true, expiresAt: true, creationFlags: true })
    .where(eq("project", "first_note"), eq("entity_type", "note"), eq("seed_id", "welcome_v1"))
    .createdBy(account.address)
    .atBlock(await publicClient.getBlockNumber({ cacheTime: 0 }))
    .limit(2)
    .fetch();
  if (prior.entities.length > 1 || prior.hasNextPage()) throw new Error("Duplicate seed: reconcile");
  const existing = prior.entities[0];
  if (existing) {
    if (!existing.creationFlags.readonly || !matches(existing.payload)) {
      throw new Error("Seed differs: reconcile instead of overwriting");
    }
    return { entityKey: existing.key, expiresAt: existing.expiresAt.toString(), reused: true };
  }
  if (await publicClient.getBalance({ address: account.address }) === 0n) {
    throw new Error("Fund the signer before writing");
  }
  // The SDK estimates gas during submission. Handle insufficient funds without retry loops.
  let created;
  try {
    created = await walletClient.createEntity(firstNoteParameters());
  } catch (error) {
    if (error instanceof EntityMutationError && error.txHash) {
      // This may be a revert OR a confirmed write whose receipt could not be decoded.
      // Inspect receipt status/logs and the scoped seed before deciding to send again.
      throw new Error(`Reconcile transaction ${error.txHash}; do not resend yet`, { cause: error });
    }
    throw error; // No hash also requires nonce/pending/seed inspection if broadcast was possible.
  }
  const page = await publicClient
    .select({ key: true, payload: true, expiresAt: true })
    .where(eq("$key", key(created.entityKey)))
    .atBlock(await publicClient.getBlockNumber({ cacheTime: 0 }))
    .limit(1)
    .fetch();
  const entity = page.entities[0];
  if (!entity || entity.key !== created.entityKey || !matches(entity.payload)) {
    throw new Error(`Read-back failed for ${created.entityKey}; reconcile, do not resend`);
  }
  if (entity.expiresAt !== created.expiresAt) {
    throw new Error(`Expiration changed for ${created.entityKey}; reconcile`);
  }
  return {
    entityKey: entity.key, txHash: created.txHash,
    expiresAt: entity.expiresAt.toString(), reused: false,
  };
}
```

The returned `expiresAt` is decoded from the create receipt in SDK 0.8.1. It is a block number, while `created_at` above is an application timestamp in milliseconds. Payload and attributes are public. Readonly and Entity Expiration do not make them private.

Inspect the confirmed transaction and entity in the [Tiramisu explorer](https://tiramisu.explorer.arkiv.network). If the host already has read-only verification tools, use their actual available schemas; the SDK and explorer suffice without an integration. Keep the returned key and hash as separate values.

## Add project rules with consent

Offer this candidate block for the consumer project's `AGENTS.md`. Ask before editing that file; preserve its existing guidance. The broader evaluation suite may refine these rules later.

```markdown
## Arkiv rules for this project
- Use @arkiv-network/sdk >=0.8.1 <0.9 on Tiramisu; inspect installed version/declarations before SDK calls. If unavailable, obtain them before producing executable SDK code; never guess exports.
- Attribute names start with a lowercase letter and use lowercase letters, digits and underscores; exclude reserved words.
- Use u64(Date.now()) for millisecond timestamps in writes and matching queries; bare numbers become i32.
- Access keys and local signing keys stay server-side; never put them in URLs, chat or public environment variables.
- Load the arkiv router for Arkiv work.
```

## Failures and testing

- `InvalidValueError` mentioning i32: use `u64` in both write and query.
- `Ident32InvalidByte` / `0x276f7798`: remove uppercase attribute names.
- `EntityMutationError` or missing read-back: reconcile; never treat a second create as repair.
- Seed collision, wrong chain or zero balance: stop before sending.

Read [testing.md](references/testing.md) for realistic fixtures and a bounded live smoke. Read `arkiv-query` for multi-page seeds; `arkiv-app-integration` for browser wallets and authenticated routes.

Sources: [SDK 0.8.1](https://www.npmjs.com/package/@arkiv-network/sdk/v/0.8.1), [create implementation](https://github.com/Arkiv-Network/arkiv-sdk-js/blob/main/src/actions/wallet/createEntity.ts), [query documentation](https://docs.arkiv.network/json-rpc/querying-data/), [faucet](https://hub.arkiv.network/faucet).
