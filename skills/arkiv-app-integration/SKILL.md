---
name: arkiv-app-integration
description: Integrate Arkiv SDK 0.8.x into server APIs, injected-wallet apps and event-driven caches. Use when building a read proxy, signing endpoint, wallet connection, DTO or live cache refresh; use arkiv-indexing for durable checkpointed mirrors and lifecycle skills for the entity mutation itself.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-08"
---

# Arkiv app integration

Choose the signing boundary before adding an endpoint. Arkiv access keys authenticate RPC access; they do not authorize your application's users or pay the signer's gas.

## Server APIs

- Keep signing keys and `X-API-KEY` access headers server-side. Use the consumer's secret store; never ask for private keys in chat or put them in public environment variables or browser bundles.
- Authenticate the session, authorize the specific operation and check CSRF, apply an attempt limit, bound and validate input, then apply a separate write limit. Invalid input consumes only the attempt budget. Test denial paths against the writer.
- A shared signer owns its new entities. Derive user identity from the verified session and enforce user access in the backend. A `user_id` attribute alone cannot enforce it on-chain. Choose a shared signer, separate server signers or a browser EOA deliberately.
- Require a stable `Idempotency-Key` and a durable operation registry before writing. Bind each user's operation ID to normalized input, chain and signer; changed input conflicts. Serialize all writers sharing that signer across processes and persist intent/nonce/signed bytes/hash before broadcasting. Return known key/hash and phase on uncertain outcomes; a timeout never authorizes a second create. See `arkiv-write-safety` for reconciliation.
- Give read proxies an allowlist of filters, page-size and total-page limits, response-size bounds and their own rate limits. Do not expose arbitrary credentialed RPC methods.
- For fresh Next.js RPC reads, use client `cacheTime: 0` and `http(url, { fetchOptions: { cache: "no-store" } })`; explicitly bypass cached heads for snapshot/expiration checks. Inspect route, application, service-worker and CDN caches too; RPC transport options cannot clear those caches.
- Return a narrow DTO with bigint block fields converted to decimal strings. Validate `entity.toJson()` before copying fields, then attach `arkivEntityKey` from the actual entity key.

Read [server-boundary.md](references/server-boundary.md) for the authorization seam and payload/DTO example. Supply real session, authorization, CSRF, rate limits and the required durable writer; a callback that directly creates on every retry violates its contract.

For provider HTTP `401`/`403`/`429`, preserve the actual status, provider code and safe diagnostic fields; never return an empty successful query. Check the access key's network, monthly cost-unit quota and IP/Origin allowlists in the [access-key guide](https://docs.arkiv.network/start-here/access-keys/). An Origin header can be forged outside a browser and is not application authentication. Respect `Retry-After` and provider cost/reset headers when supplied, stop retry storms, and keep credentialed URLs/headers out of client errors. App session failures and app rate limits are separate from provider denials.

## Browser wallets and caches

- Use an EOA wallet with an explicit connected `account`. Connect, switch to Tiramisu and handle unknown-chain code `4902` by adding the network with `blockExplorerUrls`. Recheck account/chain before each write.
- Clear pending write state and switch cache scope on `accountsChanged`, `chainChanged` and disconnect. Remove only listeners registered by your component when it unmounts. A previously constructed wallet client does not follow a changed address automatically.
- For **wagmi 2**, call `useAccount` and `useWalletClient` inside a component/custom hook in a stable, unconditional order. Return no Arkiv writer before a connected address and a Tiramisu wallet client exist. Do not use module-level hooks or non-null assertions before connection; verify exports for other installed versions.
- Keep `arkivEntityKey` in the cached result type, such as `StoredPost[]`. Cache keys include chain, account/trusted publisher, namespace, entity type and filters. Disabled detail queries still guard an absent key inside the query function.
- Faucet sign-in/SIWE is separate from your app session. Implement and verify the app's session; do not treat faucet access or possession of an RPC key as app authentication.

Read [browser-wallet.md](references/browser-wallet.md) for the injected-wallet connection helper. This does not demonstrate RainbowKit, embedded-wallet or account-abstraction compatibility.

## Realtime synchronization

The five SDK events are `EntityCreated`, `EntityPatched`, `ExpiryExtended`, `OwnershipTransferred` and `EntityDeleted`. The watcher filters Arkiv's operation address, not your project's namespace. Entity Expiration has no event.

- Fetch even unknown `EntityPatched` keys and re-evaluate namespace, authenticated authorship and collection filters; a patch can move an entity into the collection. Extensions, transfers and deletes can use prior collection membership. With a creator allowlist, cheaply drop `EntityCreated` events whose `owner` is outside that allowlist before fetching; only this creation event's owner equals its creator at creation. Fetch and validate new candidates before including them. A transfer into your wallet needs no recipient consent, so current ownership is not provenance. Use the publication gate in `arkiv-security-trust`.
- Invalidate detail and affected collection caches. Attribute/ownership changes can remove an entity from its previous scope; deletion requires the saved previous scope because a head read cannot fetch the deleted entity.
- Catch asynchronous handler failures, serialize processing where order matters, and stop the synchronous unwatch function during cleanup. A decoded event is an invalidation signal, not the full updated entity.
- Replay finite HTTP block ranges from a verified checkpoint. Shrink on `-32602 "query exceeds max results 20000, retry with the range a-b"` or viem's code-free `ResponseBodyTooLargeError`; clamp hints without skipping blocks and preserve the checkpoint on failure. Do not pass an old checkpoint directly to `watchEntityEvents({ fromBlock })`: viem's HTTP fallback can repeatedly request the entire gap. Fetch canonical hashes and use `arkiv-indexing` for durable replay/reorg recovery.
- Periodically refetch or sweep actual expiration blocks against chain head. An idle event stream does not prove a healthy connection or an unexpired cache.

Read [realtime.md](references/realtime.md) when implementing events, replay, checkpoints or expiration-aware caches.

## Verify the app boundary

Exercise unauthorized, forbidden, invalid, oversized (`413`) and rate-limited requests and prove that none invokes the writer. Test concurrent retries with one operation ID, conflicting input, unresolved receipts and post-confirmation response failure without another create or leaked provider error. Test injected account/chain changes, malformed/untrusted JSON, bigint DTO serialization, duplicate/replayed events, handler failure and cleanup. Test the consumer's real durable store, caches and session separately from a mocked SDK transport.

Source basis: [SDK source](https://github.com/Arkiv-Network/arkiv-sdk-js), [access-key docs](https://docs.arkiv.network/start-here/access-keys/), [live-event docs](https://docs.arkiv.network/typescript-sdk/live-events/). Recheck the installed SDK and wallet libraries before adapting examples.
