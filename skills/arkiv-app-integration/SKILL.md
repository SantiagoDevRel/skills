---
name: arkiv-app-integration
description: Integrate Arkiv SDK 0.8.x into server APIs, injected-wallet apps and event-driven caches. Use when building a read proxy, signing endpoint, wallet connection, DTO or live cache refresh; use arkiv-indexing for durable checkpointed mirrors and lifecycle skills for the entity mutation itself.
license: MIT
metadata:
  arkiv-sdk: ">=0.8.1 <0.9"
  network: tiramisu
  verified: "2026-10-07"
---

# Arkiv app integration

Choose the signing boundary before adding an endpoint. Arkiv access keys authenticate RPC access; they do not authorize your application's users or pay the signer's gas.

## Server APIs

- Keep signing keys and `X-API-KEY` access headers server-side. Use the consumer's secret store; never ask for private keys in chat or put them in public environment variables or browser bundles.
- Authenticate the session, authorize the specific operation, bound and validate input, apply a rate limit, then obtain/use the signer. Cookie-authenticated writes need the app's CSRF protection. Test denial paths against the signing call.
- A shared signer owns its new entities. Derive user identity from the verified session and enforce user access in the backend. A `user_id` attribute alone cannot enforce it on-chain. Choose a shared signer, separate server signers or a browser EOA deliberately.
- Serialize writes from the same signing account and preserve request/transaction identities on uncertain outcomes. See `arkiv-write-safety` for reconciliation; an RPC timeout is not proof that a write failed.
- Give read proxies an allowlist of filters, page-size and total-page limits, response-size bounds and their own rate limits. Do not expose arbitrary credentialed RPC methods.
- For fresh Next.js RPC reads, set `http(url, { fetchOptions: { cache: "no-store" } })`. Inspect route, application, service-worker and CDN caches too; RPC transport options cannot clear those caches.
- Return a narrow DTO with bigint block fields converted to decimal strings. Validate `entity.toJson()` before copying fields, then attach `arkivEntityKey` from the actual entity key.

Read [server-boundary.md](references/server-boundary.md) for a complete authorization seam and payload/DTO example. Adapt its required callbacks to real session, authorization, CSRF and rate-limit implementations; it is not a ready-made authentication system.

## Browser wallets and caches

- Use an EOA wallet with an explicit connected `account`. Connect, switch to Tiramisu and handle unknown-chain code `4902` by adding the network with `blockExplorerUrls`. Recheck account/chain before each write.
- Clear pending write state and switch cache scope on `accountsChanged`, `chainChanged` and disconnect. Remove only listeners registered by your component when it unmounts. A previously constructed wallet client does not follow a changed address automatically.
- For **wagmi 2**, call `useAccount` and `useWalletClient` inside a component/custom hook in a stable, unconditional order. Return no Arkiv writer before a connected address and a Tiramisu wallet client exist. Do not use module-level hooks or non-null assertions before connection; verify exports for other installed versions.
- Keep `arkivEntityKey` in the cached result type, such as `StoredPost[]`. Cache keys include chain, account/trusted publisher, namespace, entity type and filters. Disabled detail queries still guard an absent key inside the query function.
- Faucet sign-in/SIWE is separate from your app session. Implement and verify the app's session; do not treat faucet access or possession of an RPC key as app authentication.

Read [browser-wallet.md](references/browser-wallet.md) for the injected-wallet connection helper. This does not demonstrate RainbowKit, embedded-wallet or account-abstraction compatibility.

## Realtime synchronization

The five SDK events are `EntityCreated`, `EntityPatched`, `ExpiryExtended`, `OwnershipTransferred` and `EntityDeleted`. The watcher filters Arkiv's operation address, not your project's namespace. Entity Expiration has no event.

- Filter known-key updates and deletions using prior collection membership. Fetch and validate **new** entity keys against namespace and authenticated authorship before including them; known-key-only filtering misses new creates. A transfer into your wallet needs no recipient consent, so current ownership is not provenance. Use the publication gate in `arkiv-security-trust`.
- Invalidate detail and affected collection caches. Attribute/ownership changes can remove an entity from its previous scope; deletion requires the saved previous scope because a head read cannot fetch the deleted entity.
- Catch asynchronous handler failures, serialize processing where order matters, and stop the synchronous unwatch function during cleanup. A decoded event is an invalidation signal, not the full updated entity.
- Replay finite HTTP block ranges from a verified checkpoint; shrink ranges on explicit log/response limits and preserve the checkpoint on failure. Do not pass an old checkpoint directly to `watchEntityEvents({ fromBlock })`: viem's HTTP fallback can repeatedly request the entire gap. Fetch canonical hashes and use `arkiv-indexing` for durable replay/reorg recovery.
- Periodically refetch or sweep actual expiration blocks against chain head. An idle event stream does not prove a healthy connection or an unexpired cache.

Read [realtime.md](references/realtime.md) when implementing events, replay, checkpoints or expiration-aware caches.

## Verify the app boundary

Exercise unauthorized, forbidden, invalid and rate-limited requests and prove that none invokes the signer. Test injected account/chain changes, malformed/untrusted JSON, bigint DTO serialization, duplicate/replayed events, handler failure and cleanup. Test the consumer's real caches/session separately from a mocked SDK transport.

Source basis: [SDK source](https://github.com/Arkiv-Network/arkiv-sdk-js), [access-key docs](https://docs.arkiv.network/start-here/access-keys/), [live-event docs](https://docs.arkiv.network/typescript-sdk/live-events/). Recheck the installed SDK and wallet libraries before adapting examples.
