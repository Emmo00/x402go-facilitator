import { Address } from "viem";

/**
 * Configuration options for EVM RPC connections.
 */
export interface EvmConfig {
  /**
   * Custom RPC URL for EVM connections.
   * If not provided, defaults to the RPC URL from the chain definition.
   */
  rpcUrl?: string;
}

export type VaultDeploymentContext = {
  merchant: Address;
  payout: Address;
  transactionTag?: string;
};

/**
 * Configuration options for X402 client and facilitator operations.
 */
export interface X402Config {
  /** Configuration for EVM operations */
  evmConfig?: EvmConfig;
  operatorAddress?: Address;
  deploymentContext: VaultDeploymentContext;
  transactionTag?: string;
}
