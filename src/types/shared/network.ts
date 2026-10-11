import { z } from "zod";

export const NetworkSchema = z.enum(["celo", "celo-sepolia"]);
export type Network = z.infer<typeof NetworkSchema>;

// evm
export const SupportedEVMNetworks: Network[] = ["celo", "celo-sepolia"];
export const EvmNetworkToChainId = new Map<Network, number>([
  ["celo", 42220],
  ["celo-sepolia", 11142220],
]);

export const ChainIdToNetwork = Object.fromEntries(
  [...SupportedEVMNetworks].map(network => [EvmNetworkToChainId.get(network), network]),
) as Record<number, Network>;
