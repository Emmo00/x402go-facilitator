import { createPublicClient, createWalletClient, http, publicActions } from "viem";
import type {
  Chain,
  Transport,
  Client,
  Account,
  RpcSchema,
  PublicActions,
  WalletActions,
  PublicClient,
  LocalAccount,
} from "viem";
import { celo, celoSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import { nonceManager } from "viem/nonce";
import type { SimulateContractReturnType } from "viem";

// Create a public client for reading data
export type SignerWallet<
  chain extends Chain = Chain,
  transport extends Transport = Transport,
  account extends Account = Account,
> = Client<
  transport,
  chain,
  account,
  RpcSchema,
  PublicActions<transport, chain, account> & WalletActions<chain, account>
>;

export type ConnectedClient = PublicClient<Transport, Chain, undefined>;

export type EvmSigner = SignerWallet<Chain, Transport, Account> | LocalAccount;

/**
 * Creates a public client configured for the specified network
 *
 * @param network - The network to connect to
 * @param rpcUrl - Optional RPC URL to use for the client. If not provided, the default RPC URL will be used.
 * @returns A public client instance connected to the specified chain
 */
export function createConnectedClient(network: string, rpcUrl?: string): ConnectedClient {
  const chain = getChainFromNetwork(network);

  return createPublicClient({
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
  }).extend(publicActions);
}

/**
 * Creates a wallet client configured for the specified chain with a private key
 *
 * @param network - The network to connect to
 * @param privateKey - The private key to use for signing transactions
 * @returns A wallet client instance connected to the specified chain with the provided private key
 */
export function createSigner(
  network: string,
  privateKey: Hex,
  rpcUrl?: string,
): SignerWallet<Chain> {
  const chain = getChainFromNetwork(network);

  const walletClient = createWalletClient({
    chain,
    transport: rpcUrl ? http(rpcUrl) : http(),
    account: privateKeyToAccount(privateKey, { nonceManager }),
  });

  return walletClient.extend(publicActions);
}

/**
 * Checks if a wallet is a signer wallet
 *
 * @param wallet - The wallet to check
 * @returns True if the wallet is a signer wallet, false otherwise
 */
export function isSignerWallet<
  TChain extends Chain = Chain,
  TTransport extends Transport = Transport,
  TAccount extends Account = Account,
>(
  wallet: SignerWallet<TChain, TTransport, TAccount> | LocalAccount,
): wallet is SignerWallet<TChain, TTransport, TAccount> {
  return (
    typeof wallet === "object" && wallet !== null && "chain" in wallet && "transport" in wallet
  );
}

/**
 * Checks if a wallet is an account
 *
 * @param wallet - The wallet to check
 * @returns True if the wallet is an account, false otherwise
 */
export function isAccount<
  TChain extends Chain = Chain,
  TTransport extends Transport = Transport,
  TAccount extends Account = Account,
>(wallet: SignerWallet<TChain, TTransport, TAccount> | LocalAccount): wallet is LocalAccount {
  const w = wallet as LocalAccount;
  return (
    typeof wallet === "object" &&
    wallet !== null &&
    typeof w.address === "string" &&
    typeof w.type === "string" &&
    // Check for essential signing capabilities
    typeof w.sign === "function" &&
    typeof w.signMessage === "function" &&
    typeof w.signTypedData === "function" &&
    // Check for transaction signing (required by LocalAccount)
    typeof w.signTransaction === "function"
  );
}

/**
 * Maps network strings to Chain objects
 *
 * @param network - The network string to convert to a Chain object
 * @returns The corresponding Chain object
 */
export function getChainFromNetwork(network: string | undefined): Chain {
  if (!network) {
    throw new Error("NETWORK environment variable is not set");
  }

  switch (network) {
    case "celo":
    case "eip155:42220":
      return celo;
    case "celo-sepolia":
    case "eip155:11142220":
      return celoSepolia;
    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

const tails = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (tails.get(key) ?? Promise.resolve()).then(fn, fn);
  tails.set(
    key,
    run.catch(() => {}),
  );
  return run;
}

export async function send(wallet: SignerWallet, request: SimulateContractReturnType["request"]) {
  const chainId = wallet.chain.id;
  const account = wallet.account!;
  const attempt = () =>
    serialize(String(chainId), () => wallet.writeContract({ ...request, account }));
  try {
    return await attempt();
  } catch (e) {
    account.nonceManager?.reset({ address: account.address, chainId });
    if (/nonce too low|already known|replacement transaction underpriced/i.test(String(e)))
      return attempt();
    throw e;
  }
}
