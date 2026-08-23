import type { IBillingCharge, ChargeExplanation } from "@alga-psa/types";
import {
  computeBucketCharges,
  computeBucketPeriodState,
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
import type {
  ComputeBucketPeriodStateInputs,
  BucketPeriodState,
} from "../compute";
import type {
  ResolvedContractBillingChargeFacts,
  ResolvedContractLineFacts,
  UnpricedContractBillingObligation,
} from "./contracts";

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

/** Shared multi-period allowance transition used while normalizing bucket facts. */
export function calculateContractBucketPeriodState(
  inputs: ComputeBucketPeriodStateInputs,
): BucketPeriodState {
  return computeBucketPeriodState(inputs);
}

function lineFacts(
  line: FixedChargeComputeInputs["clientContractLine"],
  tenantId: string,
): ResolvedContractLineFacts {
  return {
    tenantId: line.tenant ?? tenantId,
    clientId: line.client_id,
    clientContractId: line.client_contract_id,
    clientContractLineId: line.client_contract_line_id,
    contractLineId: line.contract_line_id,
    contractName: line.contract_name,
    contractLineName: line.contract_line_name,
    contractLineType: line.contract_line_type,
    billingTiming: line.billing_timing,
    currencyCode: line.currency_code ?? "USD",
    locationId: line.location_id,
    customRate: line.custom_rate,
    endDate: line.end_date,
    enableProration: line.enable_proration,
    isSystemManagedDefault: line.is_system_managed_default,
  };
}

/** Adapter-only bridge from loaded production data into the public fact model. */
export function normalizeResolvedContractCharge(input: {
  obligationId: string;
  tenantId: string;
  contractLineId?: string;
  charge: ResolvedContractChargeObligation;
  taxContextKey?: string;
  metadata?: UnpricedContractBillingObligation["metadata"];
}): {
  obligation: UnpricedContractBillingObligation;
  taxContext: ChargeComputeTaxContext;
} {
  const { charge } = input;
  const common = {
    line: lineFacts(charge.inputs.clientContractLine, input.tenantId),
    client: {
      clientId: charge.inputs.client.client_id,
      isTaxExempt: charge.inputs.client.is_tax_exempt,
    },
    timing: "timing" in charge.inputs ? charge.inputs.timing : undefined,
    billingPeriod:
      "billingPeriod" in charge.inputs
        ? charge.inputs.billingPeriod
        : undefined,
    billingProfile: charge.inputs.billingProfile,
  };
  let facts: ResolvedContractBillingChargeFacts;
  switch (charge.kind) {
    case "fixed":
      facts = {
        kind: "fixed",
        ...common,
        contractLine: {
          type: charge.inputs.contractLineDetails?.contract_line_type,
          customRate: charge.inputs.contractLineDetails?.custom_rate,
          enableProration: charge.inputs.contractLineDetails?.enable_proration,
        },
        effectiveCustomRate: charge.inputs.effectiveCustomRate,
        customRateSource: charge.inputs.customRateSource,
        services: charge.inputs.planServices.map((service) => ({
          serviceId: service.service_id,
          serviceName: service.service_name,
          defaultRate: service.default_rate,
          taxRateId: service.tax_rate_id,
          configurationId: service.config_id,
          serviceQuantity: service.service_quantity,
          serviceCustomRate: service.service_line_custom_rate,
          configurationQuantity: service.configuration_quantity,
          configurationCustomRate: service.configuration_custom_rate,
          baseRate: service.service_base_rate,
          enableProration: service.enable_proration,
          quantity: service.quantity,
        })),
        fallbackService: charge.inputs.fallbackService
          ? {
              serviceId: charge.inputs.fallbackService.service_id,
              serviceName: charge.inputs.fallbackService.service_name,
              taxRateId: charge.inputs.fallbackService.tax_rate_id,
              configurationId: charge.inputs.fallbackService.config_id,
            }
          : null,
      };
      break;
    case "hourly":
      facts = {
        kind: "hourly",
        ...common,
        overtime: {
          enabled: charge.inputs.plan.enable_overtime,
          threshold: charge.inputs.plan.overtime_threshold,
          rate: charge.inputs.plan.overtime_rate,
        },
        serviceConfigurations: Array.from(
          charge.inputs.serviceConfigMap,
          ([serviceId, value]) => ({
            serviceId,
            configurationId: value.config.config_id,
            hourlyRate: value.config.hourly_rate,
            minimumBillableTime: value.config.minimum_billable_time,
            roundUpToNearest: value.config.round_up_to_nearest,
            userTypeRates: Array.from(
              value.userTypeRates,
              ([userType, rate]) => ({ userType, rate }),
            ),
          }),
        ),
        activity: charge.inputs.timeEntries.map((entry) => ({
          sourceId: entry.entry_id,
          userId: entry.user_id,
          userType: entry.user_type,
          start: entry.start_time.toISOString(),
          end: entry.end_time.toISOString(),
          serviceId: entry.service_id,
          serviceName: entry.service_name,
          taxRateId: entry.tax_rate_id,
          customRate: entry.custom_rate,
          currencyRate: entry.currency_rate,
          billableMinutes: entry.billable_duration,
          billingProfileId: entry.work_item_billing_profile_id,
        })),
      };
      break;
    case "usage":
      facts = {
        kind: "usage",
        ...common,
        serviceConfigurations: Array.from(
          charge.inputs.serviceConfigMap,
          ([serviceId, value]) => ({
            serviceId,
            configurationId: value.config.config_id,
            customRate: value.config.custom_rate,
            minimumUsage: value.config.minimum_usage,
            tieredPricing: value.config.enable_tiered_pricing,
            tiers: value.rateTiers.map((tier) => ({
              minimum: tier.min_quantity,
              maximum: tier.max_quantity,
              rate: tier.rate,
            })),
          }),
        ),
        activity: charge.inputs.usageRecords.map((record) => ({
          sourceId: record.usage_id,
          serviceId: record.service_id,
          serviceName: record.service_name,
          quantity: record.quantity,
          taxRateId: record.tax_rate_id,
          currencyRate: record.currency_rate,
        })),
      };
      break;
    case "bucket":
      facts = {
        kind: "bucket",
        ...common,
        configuration: {
          configurationId: charge.inputs.config.config_id,
          serviceId: charge.inputs.config.service_id,
          serviceName: charge.inputs.config.service_name,
          taxRateId: charge.inputs.config.tax_rate_id,
          unitOfMeasure: charge.inputs.config.unit_of_measure,
          billingMethod: charge.inputs.config.billing_method,
          includedMinutes: charge.inputs.config.total_minutes,
          includedHours: charge.inputs.config.total_hours,
          overageRate: charge.inputs.config.overage_rate,
          allowRollover: charge.inputs.config.allow_rollover,
          weighted: charge.inputs.config.isWeighted,
        },
        periods: charge.inputs.usageRecords.map((period) => ({
          start:
            period.period_start instanceof Date
              ? period.period_start.toISOString()
              : period.period_start,
          end:
            period.period_end instanceof Date
              ? period.period_end.toISOString()
              : period.period_end,
          minutesUsed: period.minutes_used,
          hoursUsed: period.hours_used,
          overageMinutes: period.overage_minutes,
          overageHours: period.overage_hours,
          rolledOverMinutes: period.rolled_over_minutes,
        })),
      };
      break;
    case "product":
    case "license":
      facts = {
        kind: charge.kind,
        ...common,
        services: charge.inputs.services.map((service) => ({
          serviceId: service.service_id,
          serviceName: service.service_name,
          defaultRate: service.default_rate,
          taxRateId: service.tax_rate_id,
          configurationId: service.config_id,
          serviceQuantity: service.service_quantity,
          serviceCustomRate: service.service_line_custom_rate,
          configurationQuantity: service.configuration_quantity,
          configurationCustomRate: service.configuration_custom_rate,
          priceRate: service.price_rate,
        })),
      };
  }
  return {
    obligation: {
      obligationId: input.obligationId,
      tenantId: input.tenantId,
      contractLineId: input.contractLineId,
      chargeFamily: facts.kind,
      taxContextKey: input.taxContextKey ?? input.obligationId,
      facts,
      metadata: input.metadata,
    },
    taxContext: charge.taxContext,
  };
}

export type ContractChargeCalculationResult = {
  executionMode: "simulate" | "live";
  /** A calculation-owned association; consumers must not reconstruct charge keys. */
  chargeExplanations: Array<{
    charge: IBillingCharge;
    explanation: ChargeExplanation;
  }>;
} & (
  | ({ kind: "fixed" } & FixedChargeComputeResult)
  | ({ kind: "hourly" } & TimeBasedChargeComputeResult)
  | ({ kind: "usage" } & UsageBasedChargeComputeResult)
  | ({ kind: "bucket" } & BucketChargeComputeResult)
  | ({ kind: "product" | "license" } & RecurringQuantityChargeComputeResult)
);

function computeLine(facts: ResolvedContractLineFacts) {
  return {
    tenant: facts.tenantId,
    client_id: facts.clientId,
    client_contract_id: facts.clientContractId,
    client_contract_line_id: facts.clientContractLineId,
    contract_line_id: facts.contractLineId,
    contract_name: facts.contractName,
    contract_line_name: facts.contractLineName,
    contract_line_type: facts.contractLineType,
    billing_timing: facts.billingTiming,
    currency_code: facts.currencyCode,
    location_id: facts.locationId,
    custom_rate: facts.customRate,
    end_date: facts.endDate,
    enable_proration: facts.enableProration,
    is_system_managed_default: facts.isSystemManagedDefault,
  } as FixedChargeComputeInputs["clientContractLine"];
}

/** Translate stable domain facts to legacy arithmetic-module inputs internally. */
export function calculateNormalizedContractCharge(
  facts: ResolvedContractBillingChargeFacts,
  executionMode: "simulate" | "live",
  taxContext: ChargeComputeTaxContext,
): ContractChargeCalculationResult {
  const clientContractLine = computeLine(facts.line);
  const client = {
    client_id: facts.client.clientId,
    is_tax_exempt: facts.client.isTaxExempt,
  };
  let obligation: ResolvedContractChargeObligation;
  switch (facts.kind) {
    case "fixed":
      obligation = {
        kind: "fixed",
        executionMode,
        taxContext,
        inputs: {
          clientId: facts.client.clientId,
          billingPeriod: facts.billingPeriod!,
          clientContractLine,
          timing: facts.timing!,
          client,
          contractLineDetails: {
            contract_line_type: facts.contractLine.type,
            custom_rate: facts.contractLine.customRate,
            enable_proration: facts.contractLine.enableProration,
          },
          effectiveCustomRate: facts.effectiveCustomRate,
          customRateSource: facts.customRateSource,
          planServices: facts.services.map((service) => ({
            service_id: service.serviceId,
            service_name: service.serviceName,
            default_rate: service.defaultRate,
            tax_rate_id: service.taxRateId,
            config_id: service.configurationId,
            service_quantity: service.serviceQuantity,
            service_line_custom_rate: service.serviceCustomRate,
            configuration_quantity: service.configurationQuantity,
            configuration_custom_rate: service.configurationCustomRate,
            service_base_rate: service.baseRate,
            enable_proration: service.enableProration,
            quantity: service.quantity,
          })),
          fallbackService: facts.fallbackService
            ? {
                service_id: facts.fallbackService.serviceId,
                service_name: facts.fallbackService.serviceName,
                tax_rate_id: facts.fallbackService.taxRateId,
                config_id: facts.fallbackService.configurationId,
              }
            : null,
          billingProfile: facts.billingProfile,
        },
      };
      break;
    case "hourly":
      obligation = {
        kind: "hourly",
        executionMode,
        taxContext,
        inputs: {
          billingPeriod: facts.billingPeriod!,
          clientContractLine,
          timing: facts.timing!,
          client,
          plan: {
            enable_overtime: facts.overtime.enabled,
            overtime_threshold: facts.overtime.threshold,
            overtime_rate: facts.overtime.rate,
          },
          serviceConfigMap: new Map(
            facts.serviceConfigurations.map((service) => [
              service.serviceId,
              {
                config: {
                  config_id: service.configurationId,
                  hourly_rate: service.hourlyRate,
                  minimum_billable_time: service.minimumBillableTime,
                  round_up_to_nearest: service.roundUpToNearest,
                },
                userTypeRates: new Map(
                  service.userTypeRates.map((rate) => [
                    rate.userType,
                    rate.rate,
                  ]),
                ),
              },
            ]),
          ),
          timeEntries: facts.activity.map((entry) => ({
            entry_id: entry.sourceId,
            user_id: entry.userId,
            user_type: entry.userType,
            start_time: new Date(entry.start),
            end_time: new Date(entry.end),
            service_id: entry.serviceId,
            service_name: entry.serviceName,
            tax_rate_id: entry.taxRateId,
            custom_rate: entry.customRate,
            currency_rate: entry.currencyRate,
            billable_duration: entry.billableMinutes,
            work_item_billing_profile_id: entry.billingProfileId,
          })),
          contractCurrency: facts.line.currencyCode,
          billingProfile: facts.billingProfile,
          resolvePhaseRateOverride: null,
          getProjectChargeConfig: null,
        },
      };
      break;
    case "usage":
      obligation = {
        kind: "usage",
        executionMode,
        taxContext,
        inputs: {
          billingPeriod: facts.billingPeriod!,
          clientContractLine,
          timing: facts.timing!,
          client,
          serviceConfigMap: new Map(
            facts.serviceConfigurations.map((service) => [
              service.serviceId,
              {
                config: {
                  config_id: service.configurationId,
                  custom_rate: service.customRate,
                  minimum_usage: service.minimumUsage,
                  enable_tiered_pricing: service.tieredPricing,
                },
                rateTiers: service.tiers.map((tier) => ({
                  min_quantity: tier.minimum,
                  max_quantity: tier.maximum,
                  rate: tier.rate,
                })),
              },
            ]),
          ),
          usageRecords: facts.activity.map((record) => ({
            usage_id: record.sourceId,
            service_id: record.serviceId,
            service_name: record.serviceName,
            quantity: record.quantity,
            tax_rate_id: record.taxRateId,
            currency_rate: record.currencyRate,
          })),
          contractCurrency: facts.line.currencyCode,
          billingProfile: facts.billingProfile,
        },
      };
      break;
    case "bucket":
      obligation = {
        kind: "bucket",
        executionMode,
        taxContext,
        inputs: {
          billingPeriod: facts.billingPeriod!,
          clientContractLine,
          client,
          config: {
            config_id: facts.configuration.configurationId,
            service_id: facts.configuration.serviceId,
            service_name: facts.configuration.serviceName,
            tax_rate_id: facts.configuration.taxRateId,
            unit_of_measure: facts.configuration.unitOfMeasure,
            billing_method: facts.configuration.billingMethod,
            total_minutes: facts.configuration.includedMinutes,
            total_hours: facts.configuration.includedHours,
            overage_rate: facts.configuration.overageRate,
            allow_rollover: facts.configuration.allowRollover,
            isWeighted: facts.configuration.weighted,
          },
          usageRecords: facts.periods.map((period) => ({
            period_start: period.start,
            period_end: period.end,
            minutes_used: period.minutesUsed,
            hours_used: period.hoursUsed,
            overage_minutes: period.overageMinutes,
            overage_hours: period.overageHours,
            rolled_over_minutes: period.rolledOverMinutes,
          })),
          contractCurrency: facts.line.currencyCode,
          billingProfile: facts.billingProfile,
        },
      };
      break;
    case "product":
    case "license":
      obligation = {
        kind: facts.kind,
        executionMode,
        taxContext,
        inputs: {
          clientContractLine,
          client,
          timing: facts.timing!,
          chargeType: facts.kind,
          services: facts.services.map((service) => ({
            service_id: service.serviceId,
            service_name: service.serviceName,
            default_rate: service.defaultRate,
            tax_rate_id: service.taxRateId,
            config_id: service.configurationId,
            service_quantity: service.serviceQuantity,
            service_line_custom_rate: service.serviceCustomRate,
            configuration_quantity: service.configurationQuantity,
            configuration_custom_rate: service.configurationCustomRate,
            price_rate: service.priceRate,
          })),
          contractCurrency: facts.line.currencyCode,
          billingProfile: facts.billingProfile,
        },
      };
  }
  return calculateContractChargeImpl(obligation);
}

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
): ContractChargeCalculationResult;
export function calculateContractCharge(
  obligation: ResolvedContractChargeObligation,
): ContractChargeCalculationResult {
  return calculateContractChargeImpl(obligation);
}

function calculateContractChargeImpl(
  obligation: ResolvedContractChargeObligation,
): ContractChargeCalculationResult {
  const associate = <
    T extends { charges: IBillingCharge[]; explanations: ChargeExplanation[] },
  >(
    result: T,
  ) => {
    if (result.charges.length !== result.explanations.length) {
      throw new Error(
        `Contract charge calculation returned ${result.charges.length} charges but ${result.explanations.length} explanations`,
      );
    }
    return {
      ...result,
      chargeExplanations: result.charges.map((charge, index) => ({
        charge,
        explanation: result.explanations[index],
      })),
    };
  };
  switch (obligation.kind) {
    case "fixed":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...associate(
          computeFixedCharges(obligation.inputs, obligation.taxContext),
        ),
      };
    case "hourly":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...associate(
          computeTimeBasedCharges(obligation.inputs, obligation.taxContext),
        ),
      };
    case "usage":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...associate(
          computeUsageBasedCharges(obligation.inputs, obligation.taxContext),
        ),
      };
    case "bucket":
      return {
        kind: obligation.kind,
        executionMode: obligation.executionMode,
        ...associate(
          computeBucketCharges(obligation.inputs, obligation.taxContext),
        ),
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
        ...associate(
          computeRecurringQuantityCharges(
            obligation.inputs,
            obligation.taxContext,
          ),
        ),
      };
  }
}

export function calculateContractDiscountsAndAdjustments(
  executionMode: "simulate" | "live",
  inputs: DiscountsAndAdjustmentsComputeInputs,
): DiscountsAndAdjustmentsComputeResult & {
  executionMode: "simulate" | "live";
} {
  return { executionMode, ...computeDiscountsAndAdjustments(inputs) };
}

/**
 * Returns the explanation emitted for a calculated charge. Charge-key
 * semantics are part of the calculation contract, not a simulator concern.
 */
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
