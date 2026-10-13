import {
  Hex,
  Account,
  Address,
  Chain,
  getAddress,
  parseSignature,
  parseEventLogs,
  parseErc6492Signature,
  Transport,
  PublicClient,
  isAddressEqual,
  BaseError,
  ContractFunctionRevertedError,
  SimulateContractReturnType,
} from "viem";
import type { VaultDeploymentContext } from "../../../types/config";
import { getERC20Balance } from "../../../shared/evm";
import {
  authorizationTypes,
  permitWitnessTypes,
  ConnectedClient,
  SignerWallet,
} from "../../../types/shared/evm";
import {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
  ExactEvmPayload,
  PaymentRequirementsV1,
  PaymentRequirementsV2,
  ExactEvmPermit2Payload,
  ErrorReasons,
} from "../../../types/verify";
import { SCHEME } from "..";
import {
  getAmountRequirement,
  getPayloadAccepted,
  sameRequirements,
  sameRequirementsV1,
  getPayloadNetwork,
} from "../../utils";
import {
  FACTORY,
  PERMIT2,
  X402_PROXY,
  resolveChain,
  getAsset,
} from "../../../types/shared/evm/config";
import {
  factoryAbi,
  vaultAbi,
  erc3009Abi,
  permit2Abi,
  erc20Abi,
} from "../../../types/shared/evm/abis";

type Prepared =
  | { ok: true; payer: Address; vault: Address; request: SimulateContractReturnType["request"] }
  | { ok: false; reason: (typeof ErrorReasons)[number]; payer?: Address };

type SimulateSettleParameters =
  | { type: "settle"; args: [Address, any] }
  | { type: "settleWithPermit2"; args: [any, Address, any, Hex] };

const bad = (invalidReason: (typeof ErrorReasons)[number], payer?: Address): Prepared => ({
  ok: false,
  reason: invalidReason,
  payer,
});

const REVERT_REASONS: Record<any, any> = {
  AmountBelowFee: "amount_below_fee",
  TokenNotSupported: "token_not_supported",
  InvalidRecipient: "invalid_recipient",
  AmountNotReceived: "amount_not_received",
};

export async function prepare(
  client: ConnectedClient,
  payload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  operatorAddress: Address,
  deploymentContext: VaultDeploymentContext,
): Promise<Prepared> {
  const isV2 = payload.x402Version === 2;
  const accepted = getPayloadAccepted(payload);
  const amount = getAmountRequirement(paymentRequirements);
  const chain = resolveChain(getPayloadNetwork(payload));

  if (!chain || resolveChain(paymentRequirements.network)?.network !== chain.network) {
    return bad("invalid_network");
  }

  const chainId = chain.chain.id;
  const sender = operatorAddress;
  if (!sender) return bad("simulation_failed");

  if (accepted.scheme !== SCHEME || paymentRequirements.scheme !== SCHEME)
    return bad("unsupported_scheme");
  // Don't trust the resource server's copy of the requirements over what the client signed up to.
  if (isV2) {
    if (!sameRequirements(payload.accepted, paymentRequirements as PaymentRequirementsV2))
      return bad("invalid_payment_requirements");
  } else {
    if (!sameRequirementsV1(payload, paymentRequirements as PaymentRequirementsV1))
      return bad("invalid_payment_requirements");
  }

  const token = getAddress(paymentRequirements.asset);
  const payTo = getAddress(paymentRequirements.payTo);
  const asset = getAsset(chain, paymentRequirements.asset);

  if (!asset) return bad("unsupported_asset");
  const method = paymentRequirements.extra?.assetTransferMethod ?? "eip3009";

  if (method !== asset.assetTransferMethod) return bad("unsupported_transfer_method");

  // 2. payTo must be one of our vaults
  const code = await client.getCode({ address: payTo });
  const deployed = !!code && code !== "0x" && code !== "0x0";

  if (deployed) {
    if (!(await isOurVault(client, payTo))) return bad("invalid_pay_to");
  } else {
    if (!deploymentContext) return bad("invalid_pay_to");
    const expected = (await client.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "vaultOf",
      args: [deploymentContext.merchant],
    })) as unknown as Address;

    if (!isAddressEqual(payTo, expected)) return bad("invalid_pay_to");
  }

  const now = (await client.getBlock()).timestamp;
  const BUFFER = 6n; // round-trip padding

  let payer: Address;
  let simulateParameters: SimulateSettleParameters;

  if (method === "eip3009") {
    const { authorization: a, signature } = payload.payload as unknown as {
      signature: Hex;
      authorization: ExactEvmPayload["authorization"];
    };
    payer = getAddress(a.from);

    if (!isAddressEqual(a.to as Address, payTo))
      return bad("invalid_exact_evm_payload_recipient_mismatch", payer);
    if (BigInt(a.value) !== amount)
      return bad("invalid_exact_evm_payload_authorization_value", payer); // "exact" means exact
    if (BigInt(a.validBefore) < now + BUFFER)
      return bad("invalid_exact_evm_payload_authorization_valid_before", payer);
    if (BigInt(a.validAfter) > now)
      return bad("invalid_exact_evm_payload_authorization_valid_after", payer);

    // Vault uses the (v, r, s) overload, so reject 1271 / 6492 / compact signatures here.
    if ((signature.length - 2) / 2 !== 65) return bad("unsupported_signature_format", payer);

    const used = await client.readContract({
      address: token,
      abi: erc3009Abi,
      functionName: "authorizationState",
      args: [payer, a.nonce],
    });
    if (used) return bad("authorization_used", payer);

    const ok = await client.verifyTypedData({
      address: payer,
      domain: { name: asset.name, version: asset.version, chainId, verifyingContract: token },
      types: authorizationTypes,
      primaryType: "TransferWithAuthorization",
      message: {
        from: a.from,
        to: a.to,
        value: BigInt(a.value),
        validAfter: BigInt(a.validAfter),
        validBefore: BigInt(a.validBefore),
        nonce: a.nonce,
      },
      signature,
    });

    if (!ok) return bad("invalid_exact_evm_payload_signature", payer);

    const { r, s, v, yParity } = parseSignature(signature);

    simulateParameters = {
      type: "settle",
      args: [
        token,
        {
          // match your Eip3009Authorization field order
          from: payer,
          value: amount,
          validAfter: BigInt(a.validAfter),
          validBefore: BigInt(a.validBefore),
          nonce: a.nonce,
          v: Number(v ?? 27n + BigInt(yParity)),
          r,
          s,
        },
      ],
    };
  } else {
    const { permit2Authorization: p, signature } = payload.payload as unknown as {
      permit2Authorization: ExactEvmPermit2Payload["permit2Authorization"];
      signature: Hex;
    };
    payer = getAddress(p.from);

    if (!isAddressEqual(p.spender as Address, X402_PROXY))
      return bad("invalid_permit2_spender", payer);
    if (!isAddressEqual(p.witness.to as Address, payTo))
      return bad("invalid_exact_evm_payload_recipient_mismatch", payer);
    if (!isAddressEqual(p.permitted.token as Address, token))
      return bad("permit2_token_mismatch", payer);
    if (BigInt(p.permitted.amount) !== amount)
      return bad("invalid_exact_evm_payload_authorization_value", payer);
    if (BigInt(p.deadline) < now + BUFFER) return bad("permit2_deadline_expired", payer);
    if (BigInt(p.witness.validAfter) > now)
      return bad("invalid_exact_evm_payload_authorization_valid_after", payer);

    // Permit2 unordered nonce: word = nonce >> 8, bit = nonce & 0xff
    const nonce = BigInt(p.nonce);
    const word = (await client.readContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: "nonceBitmap",
      args: [payer, nonce >> 8n],
    })) as unknown as bigint;

    if ((word >> (nonce & 0xffn)) & 1n) return bad("permit2_nonce_used", payer);

    const ok = await client.verifyTypedData({
      address: payer,
      domain: { name: "Permit2", chainId, verifyingContract: PERMIT2 },
      types: permitWitnessTypes, // PermitWitnessTransferFrom / TokenPermissions / Witness(address to,uint256 validAfter)
      primaryType: "PermitWitnessTransferFrom",
      message: {
        permitted: { token, amount },
        spender: X402_PROXY,
        nonce,
        deadline: BigInt(p.deadline),
        witness: { to: payTo, validAfter: BigInt(p.witness.validAfter) },
      },
      signature,
    });

    if (!ok) return bad("invalid_exact_evm_payload_signature", payer);

    const allowance = await client.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "allowance",
      args: [payer, PERMIT2],
    });
    if (allowance < amount) {
      // Either reject with permit2_allowance_required, or validate the eip2612GasSponsoring
      // extension and simulate your 2612 entrypoint instead. Only accept it if the vault implements it.
      return bad("permit2_allowance_required", payer);
    }

    simulateParameters = {
      type: "settleWithPermit2",
      args: [
        { permitted: { token, amount }, nonce, deadline: BigInt(p.deadline) },
        payer,
        { to: payTo, validAfter: BigInt(p.witness.validAfter) },
        signature,
      ],
    };
  }

  // check balance
  const balance = await getERC20Balance(client, token, payer);

  if (balance < amount) return bad("insufficient_funds", payer);

  // 5. Source of truth: simulate the exact call /settle will send
  try {
    const { request } = (await (deployed
      ? simulate(client, sender, payTo, simulateParameters)
      : simulateWithDeploy(
          client,
          sender,
          FACTORY,
          deploymentContext!,
          simulateParameters,
        ))) as unknown as SimulateContractReturnType;
    return { ok: true, payer, vault: payTo, request };
  } catch (e) {
    const revert =
      e instanceof BaseError
        ? (e.walk(
            x => x instanceof ContractFunctionRevertedError,
          ) as ContractFunctionRevertedError | null)
        : null;
    return bad(REVERT_REASONS[revert?.data?.errorName ?? ""] ?? "simulation_failed", payer);
  }
}

function simulate(
  client: ConnectedClient,
  account: Address,
  vault: Address,
  params: SimulateSettleParameters,
) {
  return params.type === "settle"
    ? client.simulateContract({
        account,
        address: vault,
        abi: vaultAbi,
        functionName: "settle",
        args: params.args,
      })
    : client.simulateContract({
        account,
        address: vault,
        abi: vaultAbi,
        functionName: "settleWithPermit2",
        args: params.args,
      });
}

function simulateWithDeploy(
  client: ConnectedClient,
  account: Address,
  factory: Address,
  deploymentContext: VaultDeploymentContext,
  params: SimulateSettleParameters,
) {
  return params.type === "settle"
    ? client.simulateContract({
        account,
        address: factory,
        abi: factoryAbi,
        functionName: "createVaultAndSettle",
        args: [deploymentContext.merchant, deploymentContext.payout, ...params.args],
      })
    : client.simulateContract({
        account,
        address: factory,
        abi: factoryAbi,
        functionName: "createVaultAndSettleWithPermit2",
        args: [deploymentContext.merchant, deploymentContext.payout, ...params.args],
      });
}

// Cache positive results forever: a vault's address and merchant never change.
const vaultCache = new Set<Address>();

async function isOurVault(
  client: ConnectedClient,
  payTo: Address,
): Promise<boolean> {
  if (vaultCache.has(payTo)) return true;

  try {
    if (!(await client.getCode({ address: payTo }))) return false;
    const merchant = (await client.readContract({
      address: payTo,
      abi: vaultAbi,
      functionName: "merchant",
    })) as unknown as Address;

    const expected = (await client.readContract({
      address: FACTORY,
      abi: factoryAbi,
      functionName: "vaultOf",
      args: [merchant],
    })) as unknown as Address;

    if (!isAddressEqual(expected, payTo)) return false;

    vaultCache.add(payTo);
    return true;
  } catch {
    return false;
  }
}

export async function verify(
  client: ConnectedClient,
  payload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  operatorAddress: Address,
  deploymentContext: VaultDeploymentContext
): Promise<VerifyResponse> {
  const r = await prepare(client, payload, paymentRequirements, operatorAddress, deploymentContext);
  return r.ok
    ? { isValid: true, invalidReason: undefined, payer: r.payer }
    : { isValid: false, invalidReason: r.reason, payer: r.payer };
}

const RETRY_WINDOW_MS = 10 * 60_000;
const RECEIPT_TIMEOUT_MS = 60_000;

// Retries (client or resource server re-sending the same payload) must not re-run a spent authorization.
// In-memory is fine for one process; use Redis or your DB if you run several.
const recent = new Map<string, { promise: Promise<SettleResponse>; at: number }>();

function settlementKey(p: PaymentPayload): string {
  const inner = p.payload;
  const network = getPayloadNetwork(p);
  if ("authorization" in inner) {
    return `${network}:3009:${inner.authorization.from}:${inner.authorization.nonce}`.toLowerCase();
  }
  if ("permit2Authorization" in inner) {
    const a = inner.permit2Authorization;
    return `${network}:permit2:${a.from}:${a.nonce}`.toLowerCase();
  }
  return `${network}:unsupported`;
}

export async function settle(
  wallet: SignerWallet<Chain, Transport>,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  deploymentContext: VaultDeploymentContext
): Promise<SettleResponse> {
  const key = settlementKey(paymentPayload);

  const existing = recent.get(key);
  if (existing && Date.now() - existing.at < RETRY_WINDOW_MS) return existing.promise;

  const promise = doSettle(wallet, paymentPayload, paymentRequirements, deploymentContext).then(res => {
    if (!res.success) recent.delete(key); // only successes are replayed; failures may be retried
    return res;
  });
  recent.set(key, { promise, at: Date.now() });
  return promise;
}

async function doSettle<transport extends Transport, chain extends Chain>(
  wallet: SignerWallet<Chain, Transport>,
  paymentPayload: PaymentPayload,
  paymentRequirements: PaymentRequirements,
  deploymentContext: VaultDeploymentContext,
): Promise<SettleResponse> {
  const network = getPayloadNetwork(paymentPayload);
  const fail = (
    errorReason: (typeof ErrorReasons)[number],
    o: { payer?: Address; transaction?: string; errorMessage?: string } = {},
  ): SettleResponse => ({
    success: false,
    errorReason,
    errorMessage: o.errorMessage,
    transaction: o.transaction ?? "",
    network,
    payer: o.payer,
  });

  // 1. Re-verify now (state may have changed since /verify) and build the exact call to send
  const prepared = await prepare(wallet as unknown as ConnectedClient, paymentPayload, paymentRequirements, wallet.account?.address ?? "", deploymentContext);
  if (!prepared.ok) return fail(prepared.reason, { payer: prepared.payer });
  const { payer, vault, request } = prepared;

  // 2. One transaction to the vault: it collects the funds and splits them atomically
  let hash: Hex;
  try {
    hash = await wallet.writeContract(request);
  } catch (e) {
    return fail("unexpected_settle_error", { payer, errorMessage: (e as Error).message });
  }

  // 3. Wait for the receipt
  let receipt;
  try {
    receipt = await wallet.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
  } catch (e) {
    // Not necessarily failed: the transaction may still land. Return the hash so it can be reconciled.
    return fail("unexpected_settle_error", {
      payer,
      transaction: hash,
      errorMessage: "receipt_timeout",
    });
  }

  if (receipt.status !== "success") {
    return fail("invalid_transaction_state", { payer, transaction: hash });
  }

  // 4. Don't trust status alone: confirm this vault actually emitted Settle
  const settled = parseEventLogs({ abi: vaultAbi, eventName: "Settle", logs: receipt.logs }).some(
    log => isAddressEqual(log.address, vault),
  );
  if (!settled) return fail("invalid_transaction_state", { payer, transaction: hash });

  return { success: true, transaction: hash, network, payer };
}
