import * as evm from "./evm/wallet";
import { SupportedEVMNetworks } from "./network";
import { Hex } from "viem";
import { X402Config } from "../config";

export type ConnectedClient = evm.ConnectedClient;
export type Signer = evm.EvmSigner;
export type MultiNetworkSigner = { evm: evm.EvmSigner };

/**
 * Creates a public client configured for the specified network.
 *
 * @param network - The network to connect to.
 * @param config - Optional X402 configuration containing custom RPC URLs.
 * @returns A public client instance connected to the specified chain.
 */
export function createConnectedClient(network: string, config?: X402Config): ConnectedClient {
  if (SupportedEVMNetworks.find(n => n === network)) {
    const rpcUrl = config?.evmConfig?.rpcUrl;
    return evm.createConnectedClient(network, rpcUrl);
  }

  throw new Error(`Unsupported network: ${network}`);
}

/**
 * Creates a wallet client configured for the specified chain with a private key.
 *
 * @param network - The network to connect to.
 * @param privateKey - The private key to use for signing transactions. This should be a hex string for EVM or a base58 encoded string for SVM.
 * @param config - Optional X402 configuration containing custom RPC URLs.
 * @returns A wallet client instance connected to the specified chain with the provided private key.
 */
export function createSigner(
  network: string,
  privateKey: Hex | string,
  config?: X402Config,
): Signer {
  if (SupportedEVMNetworks.find(n => n === network)) {
    const rpcUrl = config?.evmConfig?.rpcUrl;
    return evm.createSigner(network, privateKey as Hex, rpcUrl);
  }

  throw new Error(`Unsupported network: ${network}`);
}

/**
 * Checks if the given wallet is an EVM signer wallet.
 *
 * @param wallet - The object wallet to check.
 * @returns True if the wallet is an EVM signer wallet, false otherwise.
 */
export function isEvmSignerWallet(wallet: Signer): wallet is evm.EvmSigner {
  return evm.isSignerWallet(wallet as evm.EvmSigner) || evm.isAccount(wallet as evm.EvmSigner);
}

/**
 * Checks if the given wallet is a multi network signer wallet
 *
 * @param wallet - The object wallet to check
 * @returns True if the wallet is a multi network signer wallet, false otherwise
 */
export function isMultiNetworkSigner(wallet: object): wallet is MultiNetworkSigner {
  return "evm" in wallet && "svm" in wallet;
}
