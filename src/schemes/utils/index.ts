export * from "../exact/evm/utils/paymentUtils";
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentRequirementsV2,
  PaymentPayloadV2,
  ExactEvmPermit2Payload,
} from "../../types/verify/x402Specs";
import { Address, isAddressEqual } from "viem";

/** scheme/network for either version (v2 keeps them on `accepted`). */
export const getPayloadAccepted = (p: PaymentPayload) => (p.x402Version === 2 ? p.accepted : p);

export const getPayloadScheme = (p: PaymentPayload) => getPayloadAccepted(p).scheme;

export const getPayloadNetwork = (p: PaymentPayload) => getPayloadAccepted(p).network;

export const getAmountRequirement = (
  req: PaymentRequirements | { amount: string; maxAmountRequired: string },
) => BigInt(req.maxAmountRequired ?? req.amount);

export const isPermit2Payload = (p: PaymentPayloadV2["payload"]): p is ExactEvmPermit2Payload =>
  "permit2Authorization" in p;

// An absent assetTransferMethod means eip3009, so treat absent and "eip3009" as the same.
const transferMethod = (r: PaymentRequirementsV2): string =>
  r.extra?.assetTransferMethod ?? "eip3009";

/**
 * Returns the name of the first field that differs between what the client signed up to (`accepted`)
 * and what the resource server sent alongside it (`required`), or null if they agree.
 */
export function diffRequirements(
  accepted: PaymentRequirementsV2,
  required: PaymentRequirementsV2,
): string | null {
  if (accepted.scheme !== required.scheme) return "scheme";
  if (accepted.network !== required.network) return "network";
  if (!isAddressEqual(accepted.asset as Address, required.asset as Address)) return "asset";
  if (!isAddressEqual(accepted.payTo as Address, required.payTo as Address)) return "payTo";
  // Digits-only strings (the schema guarantees it), so BigInt is safe and "0100" equals "100".
  if (BigInt(accepted.amount) !== BigInt(required.amount)) return "amount";
  if (accepted.maxTimeoutSeconds !== required.maxTimeoutSeconds) return "maxTimeoutSeconds";
  if (transferMethod(accepted) !== transferMethod(required)) return "extra.assetTransferMethod";
  return null;
}

export const sameRequirements = (
  accepted: PaymentRequirementsV2,
  required: PaymentRequirementsV2,
): boolean => diffRequirements(accepted, required) === null;

/**
 * v1 has no `accepted` object, only top-level scheme and network on the payload.
 * Everything else (payTo, asset, amount) is checked against the signed authorization in verify.
 */
export const sameRequirementsV1 = (
  payload: Extract<PaymentPayload, { x402Version: 1 }>,
  required: Extract<PaymentRequirements, { maxAmountRequired: string }>,
): boolean => payload.scheme === required.scheme && payload.network === required.network;
