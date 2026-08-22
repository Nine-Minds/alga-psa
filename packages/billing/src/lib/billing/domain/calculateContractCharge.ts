import type {
  IBillingCharge,
  ChargeExplanation,
  IBucketCharge,
  IFixedPriceCharge,
  ILicenseCharge,
  IProductCharge,
  ITimeBasedCharge,
  IUsageBasedCharge,
} from "@alga-psa/types";
import {
  computeBucketCharges,
  computeDiscountsAndAdjustments,
  computeFixedCharges,
  computeRecurringQuantityCharges,
  computeTimeBasedCharges,
  computeUsageBasedCharges,
  type BucketChargeComputeInputs,
  type BucketChargeComputeResult,
  type ChargeComputeTaxContext,
  type DiscountsAndAdjustmentsComputeInputs,
  type DiscountsAndAdjustmentsComputeResult,
  type FixedChargeComputeInputs,
  type FixedChargeComputeResult,
  type RecurringQuantityChargeComputeInputs,
  type RecurringQuantityChargeComputeResult,
  type TimeBasedChargeComputeInputs,
  type TimeBasedChargeComputeResult,
  type UsageBasedChargeComputeInputs,
  type UsageBasedChargeComputeResult,
} from "../compute";

/**
 * A fully loaded charge-family obligation. All queries and any provisioning
 * happen before this boundary; the tax context is a synchronous snapshot.
 */
export type ResolvedContractChargeObligation = {
  executionMode: "simulate" | "live";
} & (
  | {
      kind: "fixed";
      inputs: FixedChargeComputeInputs;
      taxContext: ChargeComputeTaxContext;
    }
  | {
      kind: "hourly";
      inputs: TimeBasedChargeComputeInputs;
      taxContext: ChargeComputeTaxContext;
    }
  | {
      kind: "usage";
      inputs: UsageBasedChargeComputeInputs;
      taxContext: ChargeComputeTaxContext;
    }
  | {
      kind: "bucket";
      inputs: BucketChargeComputeInputs;
      taxContext: ChargeComputeTaxContext;
    }
  | {
      kind: "product" | "license";
      inputs: RecurringQuantityChargeComputeInputs;
      taxContext: ChargeComputeTaxContext;
    }
);

export type ContractChargeCalculationResult = {
  executionMode: "simulate" | "live";
} & (
  | ({ kind: "fixed" } & FixedChargeComputeResult)
  | ({ kind: "hourly" } & TimeBasedChargeComputeResult)
  | ({ kind: "usage" } & UsageBasedChargeComputeResult)
  | ({ kind: "bucket" } & BucketChargeComputeResult)
  | ({ kind: "product" | "license" } & RecurringQuantityChargeComputeResult)
);

/**
 * The only charge-family dispatcher for contract billing. Keep this function
 * deterministic and I/O-free: callers may load facts, but may not select a
 * compute implementation themselves.
 */
export function calculateContractCharge(
  obligation: Extract<ResolvedContractChargeObligation, { kind: "fixed" }>,
): Extract<ContractChargeCalculationResult, { kind: "fixed" }>;
export function calculateContractCharge(
  obligation: Extract<ResolvedContractChargeObligation, { kind: "hourly" }>,
): Extract<ContractChargeCalculationResult, { kind: "hourly" }>;
export function calculateContractCharge(
  obligation: Extract<ResolvedContractChargeObligation, { kind: "usage" }>,
): Extract<ContractChargeCalculationResult, { kind: "usage" }>;
export function calculateContractCharge(
  obligation: Extract<ResolvedContractChargeObligation, { kind: "bucket" }>,
): Extract<ContractChargeCalculationResult, { kind: "bucket" }>;
export function calculateContractCharge(
  obligation: Extract<
    ResolvedContractChargeObligation,
    { kind: "product" | "license" }
  >,
): Extract<ContractChargeCalculationResult, { kind: "product" | "license" }>;
export function calculateContractCharge(
  obligation: ResolvedContractChargeObligation,
): ContractChargeCalculationResult {
  return calculateContractChargeImpl(obligation);
}

function calculateContractChargeImpl(
  obligation: ResolvedContractChargeObligation,
): ContractChargeCalculationResult {
  switch (obligation.kind) {
    case "fixed":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...computeFixedCharges(obligation.inputs, obligation.taxContext),
      };
    case "hourly":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...computeTimeBasedCharges(obligation.inputs, obligation.taxContext),
      };
    case "usage":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...computeUsageBasedCharges(obligation.inputs, obligation.taxContext),
      };
    case "bucket":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...computeBucketCharges(obligation.inputs, obligation.taxContext),
      };
    case "product":
    case "license":
      if (obligation.inputs.chargeType !== obligation.kind) {
        throw new Error(
          `Recurring obligation kind ${obligation.kind} does not match charge type ${obligation.inputs.chargeType}`,
        );
      }
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...computeRecurringQuantityCharges(
          obligation.inputs,
          obligation.taxContext,
        ),
      };
  }
}

export function calculateContractDiscountsAndAdjustments(
  inputs: DiscountsAndAdjustmentsComputeInputs,
): DiscountsAndAdjustmentsComputeResult {
  return computeDiscountsAndAdjustments(inputs);
}

/**
 * Returns the explanation emitted for a calculated charge. Charge-key
 * semantics are part of the calculation contract, not a simulator concern.
 */
export function findContractChargeExplanation(
  kind: ResolvedContractChargeObligation["kind"],
  charge: IBillingCharge,
  explanations: ChargeExplanation[],
  fallbackContractLineId?: string,
): ChargeExplanation | null {
  const contractLineId =
    charge.client_contract_line_id ?? fallbackContractLineId ?? "line";
  let chargeKey: string;
  switch (kind) {
    case "fixed": {
      const fixed = charge as IFixedPriceCharge;
      chargeKey = `${fixed.config_id ?? contractLineId}:${fixed.serviceId ?? "service"}`;
      break;
    }
    case "hourly": {
      const hourly = charge as ITimeBasedCharge;
      chargeKey = `${hourly.config_id ?? contractLineId}:${hourly.serviceId}:${hourly.entryId}`;
      break;
    }
    case "usage": {
      const usage = charge as IUsageBasedCharge;
      chargeKey = `${usage.config_id ?? contractLineId}:${usage.serviceId}:${usage.usageId}`;
      break;
    }
    case "bucket": {
      const bucket = charge as IBucketCharge;
      chargeKey = `${bucket.config_id}:${bucket.serviceId}:${bucket.servicePeriodStart}:${bucket.servicePeriodEnd}`;
      break;
    }
    case "product":
    case "license": {
      const recurring = charge as IProductCharge | ILicenseCharge;
      chargeKey = `${recurring.config_id ?? contractLineId}:${recurring.serviceId}`;
      break;
    }
  }
  return explanations.find((explanation) => explanation.chargeKey === chargeKey) ?? null;
}

export interface CalculatedContractChargeBatch {
  charges: IBillingCharge[];
  explanations: ChargeExplanation[];
}

/** Calculate an ordered set of fully loaded obligations through one path. */
export function calculateContractChargeBatch(
  obligations: ResolvedContractChargeObligation[],
): CalculatedContractChargeBatch {
  const charges: IBillingCharge[] = [];
  const explanations: ChargeExplanation[] = [];
  for (const obligation of obligations) {
    const result = calculateContractChargeImpl(obligation);
    charges.push(...result.charges);
    explanations.push(...result.explanations);
  }
  return { charges, explanations };
}
