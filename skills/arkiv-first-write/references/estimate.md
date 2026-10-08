# Estimate without broadcasting

SDK 0.8.1's write actions submit by default and do not expose their operation encoder as a public API. Do not call them on an ordinary wallet transport merely to estimate. This guard uses public viem transport APIs, captures an actual `eth_estimateGas` result, and refuses broadcast before anything reaches the provider.

Pass the same `CreateEntityParameters` used for the proposed write, such as `firstNoteParameters()` in the main example. For another write, use `estimateWrite(account, wallet => wallet.executeBatch(batch), ...)` with no gas override. The callback must use only the guarded wallet and must let its errors propagate. The account stays local. The normal SDK estimation path stops before signing; every broadcast is also blocked independently. Use only a trusted local development account and do not enable raw RPC/debug logging.

```typescript
import { createWalletClient, type CreateEntityParameters } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { custom, http, MethodNotFoundRpcError, type Chain, type LocalAccount } from "viem";

export async function estimateWrite(
  account: LocalAccount,
  prepare: (wallet: ReturnType<typeof createWalletClient>) => Promise<unknown>,
  rpcUrl: string = tiramisu.rpcUrls.default.http[0],
  chain: Chain = tiramisu,
  accessKey?: string,
): Promise<bigint> {
  if (typeof prepare !== "function") throw new Error("Dry run: a write callback is required");
  if (accessKey && new URL(rpcUrl).origin !== new URL(tiramisu.rpcUrls.default.http[0]).origin) {
    throw new Error("Access key origin mismatch");
  }
  const rpc = http(rpcUrl, {
    retryCount: 0, timeout: 10_000,
    fetchOptions: { cache: "no-store", redirect: "error",
      ...(accessKey ? { headers: { "X-API-KEY": accessKey } } : {}) },
  })({ chain });
  const chainId = await rpc.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/i.test(chainId)
      || BigInt(chainId) !== BigInt(chain.id)) throw new Error("Wrong chain for dry run");
  const reads = new Set([
    "eth_chainId", "eth_blockNumber", "eth_getBlockByNumber", "eth_getTransactionCount",
    "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_estimateGas",
  ]);
  let gas: bigint | undefined;
  const stop = new Error("Dry run: estimate captured; stop before signing");
  const transport = custom({
    async request(args) {
      if (args.method === "eth_sendRawTransaction" || args.method === "eth_sendTransaction") {
        throw new Error("Dry run: broadcast blocked");
      }
      if (args.method === "eth_fillTransaction") {
        // Force viem's ordinary estimate path even if the provider implements fill.
        throw new MethodNotFoundRpcError(new Error("eth_fillTransaction is not available in this dry run"));
      }
      if (!reads.has(args.method)) throw new Error("Dry run: unexpected RPC method blocked");
      // Preserve every parameter, including fee values and their serialized widths.
      const result = await rpc.request(args);
      if (args.method === "eth_estimateGas") {
        if (typeof result !== "string" || !/^0x[0-9a-f]+$/i.test(result)) {
          throw new Error("Dry run: invalid gas estimate");
        }
        gas = BigInt(result);
        if (gas <= 0n) throw new Error("Dry run: invalid gas estimate");
        throw stop;
      }
      return result;
    },
  }, { retryCount: 0 });
  const wallet = createWalletClient({ account, chain, transport });
  try {
    await prepare(wallet);
  } catch (error) {
    let cause: unknown = error;
    for (let depth = 0; cause && depth < 24; depth++) {
      if (cause === stop && gas !== undefined) return gas;
      cause = typeof cause === "object" ? (cause as { cause?: unknown }).cause : undefined;
    }
    // A callback failure or blocked send is not evidence of a successful estimate.
    throw new Error("Dry-run preparation or gas estimation failed", { cause: error });
  }
  throw new Error("Dry-run callback swallowed the guard or skipped estimation");
}

export async function estimateCreate(
  account: LocalAccount,
  data: CreateEntityParameters,
  rpcUrl: string = tiramisu.rpcUrls.default.http[0],
  chain: Chain = tiramisu,
  accessKey?: string,
) {
  return estimateWrite(account, wallet => wallet.createEntity(data), rpcUrl, chain, accessKey);
}
```

Only report success when the helper returns a gas value. Test the guard against both broadcast methods, an estimation failure and an unexpected RPC method. No provider request may use a broadcast method. Estimation can still fail because of network, fee or state requirements; do not weaken the guard or invent a passed estimate.

Gas units are not a fee quote. Recompute current fees and verify funding before a separately authorized write. An unfunded account can fail the provider's balance checks; do not strip fee fields to manufacture a passing estimate. Request-size acceptance applies only to this exact estimation request, not the differently encoded signed submission. The proposed payload, block conversion and chain state can change between estimation and inclusion. Optional access keys are sent only to the official Tiramisu RPC origin; redirects fail closed.

Sources: [SDK transaction path](https://unpkg.com/@arkiv-network/sdk@0.8.1/src/utils/arkivTransactions.ts), [viem custom transport](https://viem.sh/docs/clients/transports/custom), [viem HTTP transport](https://viem.sh/docs/clients/transports/http).
