import { z } from "zod";
import { NetworkSchema } from "../shared";
import { Base64EncodedRegex } from "../../shared/base64";
import type { Hex } from "viem";

// Constants
// uint256 has at most 78 decimal digits. This was 18, which rejected 1.0 of any 18-decimal token.
const EvmMaxAtomicUnits = 78;
const EvmAddressRegex = /^0x[0-9a-fA-F]{40}$/;
const SvmAddressRegex = /^[A-Za-z0-9][A-Za-z0-9-]{0,34}[A-Za-z0-9]$/; // Solana base58 addresses are 32 bytes, but can be up to 44 chars in base58
const MixedAddressRegex = /^0x[a-fA-F0-9]{40}|[A-Za-z0-9][A-Za-z0-9-]{0,34}[A-Za-z0-9]$/;
const HexEncoded64ByteRegex = /^0x[0-9a-fA-F]{64}$/;
const EvmSignatureRegex = /^0x[0-9a-fA-F]+$/; // Flexible hex signature validation
const Caip2Regex = /^[a-z0-9-]{3,8}:[a-zA-Z0-9_-]{1,32}$/; // e.g. eip155:42220

// Enums
export const schemes = ["exact"] as const;
export const x402Versions = [1, 2] as const;
export const ErrorReasons = [
  "insufficient_funds",
  "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_payload_authorization_valid_before",
  "invalid_exact_evm_payload_authorization_value",
  "invalid_exact_evm_payload_signature",
  "invalid_exact_evm_payload_recipient_mismatch",
  "invalid_exact_svm_payload_transaction",
  "invalid_exact_svm_payload_transaction_amount_mismatch",
  "invalid_exact_svm_payload_transaction_create_ata_instruction",
  "invalid_exact_svm_payload_transaction_create_ata_instruction_incorrect_payee",
  "invalid_exact_svm_payload_transaction_create_ata_instruction_incorrect_asset",
  "invalid_exact_svm_payload_transaction_instructions",
  "invalid_exact_svm_payload_transaction_instructions_length",
  "invalid_exact_svm_payload_transaction_instructions_compute_limit_instruction",
  "invalid_exact_svm_payload_transaction_instructions_compute_price_instruction",
  "invalid_exact_svm_payload_transaction_instructions_compute_price_instruction_too_high",
  "invalid_exact_svm_payload_transaction_instruction_not_spl_token_transfer_checked",
  "invalid_exact_svm_payload_transaction_instruction_not_token_2022_transfer_checked",
  "invalid_exact_svm_payload_transaction_not_a_transfer_instruction",
  "invalid_exact_svm_payload_transaction_receiver_ata_not_found",
  "invalid_exact_svm_payload_transaction_sender_ata_not_found",
  "invalid_exact_svm_payload_transaction_simulation_failed",
  "invalid_exact_svm_payload_transaction_transfer_to_incorrect_ata",
  "invalid_network",
  "invalid_payload",
  "invalid_payment_requirements",
  "invalid_scheme",
  "invalid_payment",
  "payment_expired",
  "unsupported_scheme",
  "invalid_x402_version",
  "invalid_transaction_state",
  "settle_exact_svm_block_height_exceeded",
  "settle_exact_svm_transaction_confirmation_timed_out",
  "unexpected_settle_error",
  "unexpected_verify_error",
  // --- vault facilitator additions ---
  "unsupported_asset",
  "unsupported_transfer_method",
  "invalid_pay_to",
  "token_not_supported",
  "amount_below_fee",
  "unsupported_signature_format",
  "authorization_used",
  "invalid_permit2_spender",
  "permit2_token_mismatch",
  "permit2_deadline_expired",
  "permit2_nonce_used",
  "permit2_allowance_required",
  "amount_not_received",
  "simulation_failed",
] as const;

// Refiners
// Digits only: rejects "1e3", "0x10", "-1", "1.5", which Number()-based checks let through.
const isInteger: (value: string) => boolean = value => /^\d+$/.test(value);
const hasMaxLength = (maxLength: number) => (value: string) => value.length <= maxLength;

// Networks: v1 uses names ("celo"), v2 uses CAIP-2 ("eip155:42220").
// NetworkSchema from ../shared must include "celo" for v1.
const NetworkV2Schema = z.string().regex(Caip2Regex);
const AnyNetworkSchema = z.union([NetworkSchema, NetworkV2Schema]);

// x402PaymentRequirements
const EvmOrSvmAddress = z.string().regex(EvmAddressRegex).or(z.string().regex(SvmAddressRegex));
const mixedAddressOrSvmAddress = z
  .string()
  .regex(MixedAddressRegex)
  .or(z.string().regex(SvmAddressRegex));

// v1
export const PaymentRequirementsV1Schema = z.object({
  scheme: z.enum(schemes),
  network: NetworkSchema,
  maxAmountRequired: z.string().refine(isInteger),
  resource: z.string().url(),
  description: z.string(),
  mimeType: z.string(),
  outputSchema: z.record(z.any()).optional(),
  payTo: EvmOrSvmAddress,
  maxTimeoutSeconds: z.number().int(),
  asset: mixedAddressOrSvmAddress,
  extra: z.record(z.any()).optional(),
});
export type PaymentRequirementsV1 = z.infer<typeof PaymentRequirementsV1Schema>;

// v2: `amount` replaces `maxAmountRequired`; resource/description/mimeType moved to the payload's `resource`
const PaymentRequirementsV2ExtraSchema = z
  .object({
    name: z.string().optional(), // don't trust for signature domains; read from your own config
    version: z.string().optional(),
    assetTransferMethod: z.enum(["eip3009", "permit2"]).optional(), // absent means eip3009
  })
  .passthrough();

export const PaymentRequirementsV2Schema = z.object({
  scheme: z.enum(schemes),
  network: NetworkV2Schema,
  asset: mixedAddressOrSvmAddress,
  amount: z.string().refine(isInteger).refine(hasMaxLength(EvmMaxAtomicUnits)),
  payTo: EvmOrSvmAddress,
  maxTimeoutSeconds: z.number().int(),
  extra: PaymentRequirementsV2ExtraSchema.optional(),
});
export type PaymentRequirementsV2 = z.infer<typeof PaymentRequirementsV2Schema>;

export const PaymentRequirementsSchema = z.union([
  PaymentRequirementsV1Schema,
  PaymentRequirementsV2Schema,
]);

export type PaymentRequirements = PaymentRequirementsV1 | PaymentRequirementsV2;

// x402ExactEvmPayload
export const ExactEvmPayloadAuthorizationSchema = z.object({
  from: z.string().regex(EvmAddressRegex),
  to: z.string().regex(EvmAddressRegex),
  value: z.string().refine(isInteger).refine(hasMaxLength(EvmMaxAtomicUnits)),
  validAfter: z.string().refine(isInteger),
  validBefore: z.string().refine(isInteger),
  nonce: z.string().regex(HexEncoded64ByteRegex),
});
export type ExactEvmPayloadAuthorization = z.infer<typeof ExactEvmPayloadAuthorizationSchema>;

export const ExactEvmPayloadSchema = z.object({
  signature: z.string().regex(EvmSignatureRegex),
  authorization: ExactEvmPayloadAuthorizationSchema,
});
export type ExactEvmPayload = z.infer<typeof ExactEvmPayloadSchema>;

// Permit2 via x402ExactPermit2Proxy (v2 only)
export const ExactEvmPermit2PayloadSchema = z.object({
  signature: z.string().regex(EvmSignatureRegex),
  permit2Authorization: z.object({
    from: z.string().regex(EvmAddressRegex),
    permitted: z.object({
      token: z.string().regex(EvmAddressRegex),
      amount: z.string().refine(isInteger).refine(hasMaxLength(EvmMaxAtomicUnits)),
    }),
    spender: z.string().regex(EvmAddressRegex), // must be the x402 proxy
    nonce: z.string().refine(isInteger).refine(hasMaxLength(EvmMaxAtomicUnits)),
    deadline: z.string().refine(isInteger),
    witness: z.object({
      to: z.string().regex(EvmAddressRegex),
      validAfter: z.string().refine(isInteger),
    }),
  }),
});
export type ExactEvmPermit2Payload = z.infer<typeof ExactEvmPermit2PayloadSchema>;

// x402ExactSvmPayload
export const ExactSvmPayloadSchema = z.object({
  transaction: z.string().regex(Base64EncodedRegex),
});
export type ExactSvmPayload = z.infer<typeof ExactSvmPayloadSchema>;

// x402PaymentPayload
const ResourceInfoSchema = z.object({
  url: z.string().url(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

// info fields: confirm against the @x402/extensions types; passthrough keeps unknown fields
const Eip2612GasSponsoringSchema = z
  .object({
    info: z
      .object({
        from: z.string().regex(EvmAddressRegex),
        asset: z.string().regex(EvmAddressRegex),
        spender: z.string().regex(EvmAddressRegex),
        amount: z.string().refine(isInteger),
        nonce: z.string().refine(isInteger),
        deadline: z.string().refine(isInteger),
        signature: z.string().regex(EvmSignatureRegex),
        version: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export const PaymentPayloadV1Schema = z.object({
  x402Version: z.literal(1),
  scheme: z.enum(schemes),
  network: NetworkSchema,
  payload: z.union([ExactEvmPayloadSchema, ExactSvmPayloadSchema]),
});
export type PaymentPayloadV1 = z.infer<typeof PaymentPayloadV1Schema>;

// v2: scheme/network live on `accepted`, not at the top level
export const PaymentPayloadV2Schema = z.object({
  x402Version: z.literal(2),
  resource: ResourceInfoSchema.optional(),
  accepted: PaymentRequirementsV2Schema,
  payload: z.union([ExactEvmPayloadSchema, ExactEvmPermit2PayloadSchema, ExactSvmPayloadSchema]),
  extensions: z
    .object({ eip2612GasSponsoring: Eip2612GasSponsoringSchema.optional() })
    .catchall(z.unknown())
    .optional(),
});
export type PaymentPayloadV2 = z.infer<typeof PaymentPayloadV2Schema>;

export const PaymentPayloadSchema = z
  .discriminatedUnion("x402Version", [PaymentPayloadV1Schema, PaymentPayloadV2Schema])
  .superRefine((p, ctx) => {
    if (p.x402Version !== 2 || !p.accepted.network.startsWith("eip155:")) return;

    // the payload shape must agree with the declared transfer method
    const method = p.accepted.extra?.assetTransferMethod ?? "eip3009";
    const hasPermit2 = "permit2Authorization" in p.payload;
    if ((method === "permit2") !== hasPermit2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "payload shape does not match accepted.extra.assetTransferMethod",
      });
    }

    // the 2612 extension only makes sense with Permit2
    if (method !== "permit2" && p.extensions?.eip2612GasSponsoring) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["extensions", "eip2612GasSponsoring"],
        message: "eip2612GasSponsoring requires the permit2 transfer method",
      });
    }
  });
export type PaymentPayload = z.infer<typeof PaymentPayloadSchema>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type UnsignedPaymentPayload = DistributiveOmit<PaymentPayload, "payload"> & {
  payload: Omit<ExactEvmPayload, "signature"> & { signature: undefined };
};

// x402 Resource Server Response
export const x402ResponseSchema = z.object({
  x402Version: z.number().refine(val => x402Versions.includes(val as 1 | 2)),
  error: z.enum(ErrorReasons).optional(),
  resource: ResourceInfoSchema.optional(), // v2
  accepts: z.array(PaymentRequirementsSchema).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(), // v2
  payer: z.string().regex(MixedAddressRegex).optional(),
});
export type x402Response = z.infer<typeof x402ResponseSchema>;

// x402RequestStructure
const HTTPVerbsSchema = z.enum(["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"]);
export type HTTPVerbs = z.infer<typeof HTTPVerbsSchema>;

export const HTTPRequestStructureSchema = z.object({
  type: z.literal("http"),
  method: HTTPVerbsSchema,
  queryParams: z.record(z.string(), z.string()).optional(),
  bodyType: z.enum(["json", "form-data", "multipart-form-data", "text", "binary"]).optional(),
  bodyFields: z.record(z.string(), z.any()).optional(),
  headerFields: z.record(z.string(), z.any()).optional(),
});

export const RequestStructureSchema = z.discriminatedUnion("type", [
  HTTPRequestStructureSchema,
  // MCPRequestStructureSchema,
  // OpenAPIRequestStructureSchema,
]);

export type HTTPRequestStructure = z.infer<typeof HTTPRequestStructureSchema>;
// export type MCPRequestStructure = z.infer<typeof MCPRequestStructureSchema>;
// export type OpenAPIRequestStructure = z.infer<typeof OpenAPIRequestStructureSchema>;
export type RequestStructure = z.infer<typeof RequestStructureSchema>;

// x402DiscoveryResource
export const DiscoveredResourceSchema = z.object({
  resource: z.string(),
  type: z.enum(["http"]),
  x402Version: z.number().refine(val => x402Versions.includes(val as 1 | 2)),
  accepts: z.array(PaymentRequirementsSchema),
  lastUpdated: z.date(),
  metadata: z.record(z.any()).optional(),
});
export type DiscoveredResource = z.infer<typeof DiscoveredResourceSchema>;

// Facilitator request bodies: v2 sends a top-level x402Version too.
// The payload and requirements must be the same protocol version.
const refineRequestPairing = (
  req: {
    x402Version?: number;
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
  },
  ctx: z.RefinementCtx,
) => {
  const payloadVersion = req.paymentPayload.x402Version;
  const requirementsAreV2 = "amount" in req.paymentRequirements;
  if ((payloadVersion === 2) !== requirementsAreV2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paymentRequirements"],
      message: "paymentRequirements version does not match paymentPayload.x402Version",
    });
  }
  if (req.x402Version !== undefined && req.x402Version !== payloadVersion) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["x402Version"],
      message: "x402Version does not match paymentPayload.x402Version",
    });
  }
};

// x402SettleRequest
export const SettleRequestSchema = z
  .object({
    x402Version: z.number().optional(),
    paymentPayload: PaymentPayloadSchema,
    paymentRequirements: PaymentRequirementsSchema,
  })
  .superRefine(refineRequestPairing);
export type SettleRequest = z.infer<typeof SettleRequestSchema>;

// x402VerifyRequest
export const VerifyRequestSchema = z
  .object({
    x402Version: z.number().optional(),
    paymentPayload: PaymentPayloadSchema,
    paymentRequirements: PaymentRequirementsSchema,
  })
  .superRefine(refineRequestPairing);
export type VerifyRequest = z.infer<typeof VerifyRequestSchema>;

// x402VerifyResponse
export const VerifyResponseSchema = z.object({
  isValid: z.boolean(),
  invalidReason: z.enum(ErrorReasons).optional(),
  invalidMessage: z.string().optional(), // v2
  payer: EvmOrSvmAddress.optional(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

// x402SettleResponse
export const SettleResponseSchema = z.object({
  success: z.boolean(),
  errorReason: z.enum(ErrorReasons).optional(),
  errorMessage: z.string().optional(), // v2
  payer: EvmOrSvmAddress.optional(),
  // empty string allowed: failed settlements have no transaction
  transaction: z.string().regex(MixedAddressRegex).or(z.literal("")),
  network: AnyNetworkSchema,
});
export type SettleResponse = z.infer<typeof SettleResponseSchema>;

// x402DiscoverListRequest
export const ListDiscoveryResourcesRequestSchema = z.object({
  type: z.string().optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
});
export type ListDiscoveryResourcesRequest = z.infer<typeof ListDiscoveryResourcesRequestSchema>;

// x402ListDiscoveryResourcesResponse
export const ListDiscoveryResourcesResponseSchema = z.object({
  x402Version: z.number().refine(val => x402Versions.includes(val as 1 | 2)),
  items: z.array(DiscoveredResourceSchema),
  pagination: z.object({
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  }),
});
export type ListDiscoveryResourcesResponse = z.infer<typeof ListDiscoveryResourcesResponseSchema>;

// x402SupportedPaymentKind
export const SupportedPaymentKindSchema = z.object({
  x402Version: z.number().refine(val => x402Versions.includes(val as 1 | 2)),
  scheme: z.enum(schemes),
  network: AnyNetworkSchema,
  extra: z.record(z.any()).optional(),
});
export type SupportedPaymentKind = z.infer<typeof SupportedPaymentKindSchema>;

// x402SupportedPaymentKindsResponse
export const SupportedPaymentKindsResponseSchema = z.object({
  kinds: z.array(SupportedPaymentKindSchema),
  extensions: z.array(z.string()).optional(), // v2, e.g. ["eip2612GasSponsoring"]
  signers: z.record(z.string(), z.array(z.string())).optional(), // v2
});
export type SupportedPaymentKindsResponse = z.infer<typeof SupportedPaymentKindsResponseSchema>;