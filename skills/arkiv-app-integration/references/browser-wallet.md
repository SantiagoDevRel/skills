# Injected browser wallet

This helper connects an EIP-1193 wallet and supplies an explicit account to SDK 0.8.1. Run it in a user-triggered browser interaction. It does not sign an entity write or supply a server key. `isAddress` validates address format only; it does not prove an EOA or account-abstraction compatibility. Verify the intended wallet's EOA signing path separately.

```typescript
import { createWalletClient } from "@arkiv-network/sdk"
import { tiramisu } from "@arkiv-network/sdk/chains"
import { custom, isAddress, type EIP1193Provider } from "viem"

export async function connectArkivWallet(provider: EIP1193Provider) {
  const addresses = await provider.request({ method: "eth_requestAccounts" })
  const account = addresses[0]
  if (!account || !isAddress(account)) throw new Error("Connect a valid wallet account")
  try {
    await provider.request({ method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7614d1" }] })
  } catch (error) {
    if (typeof error !== "object" || error === null || !("code" in error) ||
        error.code !== 4902) throw error
    await provider.request({ method: "wallet_addEthereumChain", params: [{
      chainId: "0x7614d1", chainName: "Arkiv Tiramisu Testnet",
      nativeCurrency: tiramisu.nativeCurrency,
      rpcUrls: [tiramisu.rpcUrls.default.http[0]],
      blockExplorerUrls: ["https://tiramisu.explorer.arkiv.network"],
    }] })
    await provider.request({ method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x7614d1" }] })
  }
  if (await provider.request({ method: "eth_chainId" }) !== "0x7614d1") {
    throw new Error("Wallet is not on Tiramisu")
  }
  const current = await provider.request({ method: "eth_accounts" })
  if (current[0]?.toLowerCase() !== account.toLowerCase()) {
    throw new Error("Wallet account changed during connection")
  }
  return createWalletClient({ chain: tiramisu, account, transport: custom(provider) })
}
```

An injected provider can change while the connection dialog is open. This helper rechecks the selected account after switching; the app must also recheck it and the chain immediately before signing. Handle rejection as a canceled interaction, without retrying a write.

Register `accountsChanged`, `chainChanged` and `disconnect` listeners to reset pending state and caches; remove these same listeners on cleanup. Cancel/ignore late reads from the previous scope. Do not keep using a wallet client created with a former address.

For wagmi 2, call hooks unconditionally inside a React component/custom hook, then gate their returned values. Confirm the connected address and Tiramisu chain on both account state and wallet client before constructing an Arkiv client with `account: address` and `transport: custom(walletClient.transport)`. Check other versions' exports rather than copying a hook name blindly. Cache result types must retain chain entity identity, not only payload fields. See the versioned [useAccount](https://2.x.wagmi.sh/react/api/hooks/useAccount) and [useWalletClient](https://2.x.wagmi.sh/react/api/hooks/useWalletClient) docs.

Tiramisu uses chain ID `7738577` (`0x7614d1`). Its SDK chain definition does not include `blockExplorers`, so the add-chain request includes the official explorer explicitly. Read [network documentation](https://docs.arkiv.network/networks/tiramisu/) before changing connection details. Provider availability, wallet UI, browser behavior and rate limits need consumer-specific verification.

The `4902` branch follows [MetaMask network management](https://docs.metamask.io/metamask-connect/evm/guides/manage-networks/). Other providers may report different errors; preserve their actual codes and messages rather than treating every switch failure as an unknown network.
