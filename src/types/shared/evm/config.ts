import { isAddressEqual, type Address, type Chain } from "viem";
import { celo, celoSepolia } from "viem/chains";

export type TransferMethod = "eip3009" | "permit2";

export interface AssetConfig {
  address: Address;
  symbol: string;
  decimals: number;
  name: string;      // EIP-712 domain name (3009 / 2612). Not necessarily the ERC-20 name().
  version: string;   // EIP-712 domain version
  assetTransferMethod: TransferMethod;
}

export interface ChainConfig {
  v1Network: string;               // "celo" | "celo-sepolia"
  network: `eip155:${number}`;     // CAIP-2, used by v2
  chain: Chain;
  rpcUrl: string;
  factory: Address;                // one X402VaultFactory per chain
  permit2: Address;
  x402Proxy: Address;
  extensions: string[];            // only list what your vault implements (settleWithPermit)
  defaultAsset: Address;
  assets: AssetConfig[];
}

export const FACTORY: Address = "0x2812dD80f3a71c154F40AF036C8F18A36eCF9868"

export const FACILITATOR: Address = "0x402001B3fbf1462939657eb7f64EE3743eAdf35E"

export const PERMIT2: Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";

export const X402_PROXY: Address = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";

export const CHAINS: ChainConfig[] = [
  {
    v1Network: "celo",
    network: "eip155:42220",
    chain: celo,
    rpcUrl: process.env.CELO_RPC_URL!,
    factory: process.env.CELO_FACTORY as Address,
    permit2: PERMIT2,
    x402Proxy: X402_PROXY,
    extensions: ["eip2612GasSponsoring"],
    defaultAsset: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
    assets: [
      { address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C", symbol: "USDC", decimals: 6, name: "USDC", version: "2", assetTransferMethod: "eip3009" },
      { address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e", symbol: "USDT", decimals: 6, name: "Tether USD", version: "1", assetTransferMethod: "eip3009" },
      { address: "0xD2ab3C9A02DBBAB236BfEC45D1d755DF4267F771", symbol: "USAT", decimals: 6, name: "Tether America USD", version: "1", assetTransferMethod: "eip3009" },
    ],
  },
  {
    v1Network: "celo-sepolia",
    network: "eip155:11142220",
    chain: celoSepolia,
    rpcUrl: process.env.CELO_SEPOLIA_RPC_URL!,
    factory: process.env.CELO_SEPOLIA_FACTORY as Address,
    permit2: PERMIT2,
    x402Proxy: X402_PROXY,
    extensions: ["eip2612GasSponsoring"],
    defaultAsset: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
    assets: [
      { address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E", symbol: "USDC", decimals: 6, name: "USDC", version: "2", assetTransferMethod: "eip3009" },
    ],
  },
];

const byNetwork = new Map<string, ChainConfig>();

for (const c of CHAINS) {
  byNetwork.set(c.v1Network.toLowerCase(), c);
  byNetwork.set(c.network.toLowerCase(), c);
}

export const resolveChain = (network: string): ChainConfig | undefined =>
  byNetwork.get(network.toLowerCase());

export const getAsset = (chain: ChainConfig, address: string): AssetConfig | undefined =>
  chain.assets.find((a) => isAddressEqual(a.address, address as Address));
