import { CHAINS, resolveChain, type AssetConfig, type ChainConfig } from "../../../types/shared/evm/config";

const assetView = (a: AssetConfig) => ({
  asset: a.address,
  symbol: a.symbol,
  decimals: a.decimals,
  name: a.name,
  version: a.version,
  assetTransferMethod: a.assetTransferMethod,
});

async function kindsFor(chain: ChainConfig) {
  const assets = chain.assets;
  if (assets.length === 0) return [];
  const def = assets.find(a => a.address === chain.defaultAsset) ?? assets[0];

  // v1 payloads have no Permit2 shape, so v1 clients may only be offered EIP-3009 assets
  const v1Assets = assets.filter(a => a.assetTransferMethod === "eip3009");

  return [
    {
      x402Version: 2,
      scheme: "exact",
      network: chain.network,
      extra: {
        extensions: chain.extensions,
        defaultAsset: assetView(def),
        supportedAssets: assets.map(assetView),
      },
    },
    ...(v1Assets.length
      ? [
          {
            x402Version: 1,
            scheme: "exact",
            network: chain.v1Network,
            extra: {
              defaultAsset: assetView(v1Assets.find(a => a === def) ?? v1Assets[0]),
              supportedAssets: v1Assets.map(assetView),
            },
          },
        ]
      : []),
  ];
}

export async function buildSupported(signerAddress: string, network?: string) {
  const chains = network ? [resolveChain(network)].filter((c): c is ChainConfig => !!c) : CHAINS;
  if (network && chains.length === 0) return null; // unknown network

  const kinds = (await Promise.all(chains.map(kindsFor))).flat();
  return {
    kinds,
    extensions: [...new Set(chains.flatMap(c => c.extensions))],
    signers: Object.fromEntries(chains.map(c => [c.network, [signerAddress]])),
  };
}
