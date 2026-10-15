import { z } from "zod";

export const NetworkSchema = z.enum(["celo", "celo-sepolia", "eip155:42220", "eip155:11142220"]);
export type Network = z.infer<typeof NetworkSchema>;

// evm
export const SupportedEVMNetworks: Network[] = ["celo", "celo-sepolia", "eip155:42220", "eip155:11142220"];
export const EvmNetworkToChainId = new Map<Network, number>([
  ["celo", 42220],
  ["eip155:42220", 42220],
  ["celo-sepolia", 11142220],
  ["eip155:11142220", 11142220],
]);

export const ChainIdToNetwork = Object.fromEntries(
  [...SupportedEVMNetworks].map(network => [EvmNetworkToChainId.get(network), network]),
) as Record<number, Network>;
