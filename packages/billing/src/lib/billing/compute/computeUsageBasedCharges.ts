import type {
  ChargeExplanation,
  IBillingPeriod,
  IClientContractLine,
  IUsageBasedCharge,
} from "@alga-psa/types";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeComputeTiming,
  ChargeProfileAssignments,
} from "./types";
import { resolveChargeProfileFor } from "../billingProfileResolution";

export interface UsageRecordComputeRow {
  usage_id: string;
  service_id: string;
  service_name?: string | null;
  quantity: number | string;
  tax_rate_id?: string | null;
  currency_rate?: number | string | null;
}

export interface UsageRateTier {
  min_quantity: number | string;
  max_quantity: number | string | null;
  rate: number | string;
}

export interface UsageServiceConfigEntry {
  config: {
    config_id: string;
    custom_rate?: number | null;
    minimum_usage?: number | string | null;
    enable_tiered_pricing?: boolean | null;
  };
  rateTiers: UsageRateTier[];
}

export interface UsageBasedChargeComputeInputs {
  billingPeriod: IBillingPeriod;
  clientContractLine: IClientContractLine;
  timing: ChargeComputeTiming;
  client: ChargeComputeClient;
  serviceConfigMap: Map<string, UsageServiceConfigEntry>;
  usageRecords: UsageRecordComputeRow[];
  contractCurrency: string;
  /**
   * usage_tracking carries no segment-bearing field, so usage charges stop at
   * the contract step of the resolution chain (F025, documented via F070).
   */
  billingProfile?: ChargeProfileAssignments | null;
}

export interface UsageBasedChargeComputeResult {
  charges: IUsageBasedCharge[];
  explanations: ChargeExplanation[];
}

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2);
}

export function computeUsageBasedCharges(
  inputs: UsageBasedChargeComputeInputs,
  taxPorts: ChargeComputeTaxPorts,
): UsageBasedChargeComputeResult {
  const {
    billingPeriod,
    clientContractLine,
    timing,
    client,
    serviceConfigMap,
    usageRecords,
    contractCurrency,
    billingProfile,
  } = inputs;
  const resolvedProfile = resolveChargeProfileFor(billingProfile);
  const explanations: ChargeExplanation[] = [];
  const isSystemManagedDefault =
    clientContractLine.is_system_managed_default === true;

  const charges = usageRecords.map((record): IUsageBasedCharge => {
    const serviceConfig = serviceConfigMap.get(record.service_id);
    const rawQuantity = Number(record.quantity);
    let quantity = rawQuantity;
    let minimumApplied = false;
    const minimumUsage = Number(serviceConfig?.config.minimum_usage ?? 0);

    if (!isSystemManagedDefault && serviceConfig && quantity < minimumUsage) {
      quantity = minimumUsage;
      minimumApplied = true;
    }

    const configuredCustomRate =
      !isSystemManagedDefault && serviceConfig?.config.custom_rate
        ? Number(serviceConfig.config.custom_rate)
        : undefined;
    const resolvedRate =
      configuredCustomRate ??
      (record.currency_rate != null ? Number(record.currency_rate) : undefined);
    const tiered = Boolean(
      !isSystemManagedDefault &&
      serviceConfig?.config.enable_tiered_pricing &&
      serviceConfig.rateTiers.length > 0,
    );

    if (resolvedRate === undefined && !tiered) {
      throw new Error(
        `Missing pricing for usage on service "${record.service_name}" (${record.service_id}) in ${contractCurrency}. ` +
          `Add a ${contractCurrency} price in the service catalog, set a custom rate on the contract line, or enable tiered pricing.`,
      );
    }

    let rate = Math.ceil(resolvedRate ?? 0);
    let total = Math.ceil(quantity * rate);
    const tierSteps: string[] = [];

    if (tiered && serviceConfig) {
      total = 0;
      let remainingQuantity = quantity;

      for (const tier of serviceConfig.rateTiers) {
        if (remainingQuantity <= 0) break;

        const tierMin = Number(tier.min_quantity);
        const tierMax =
          tier.max_quantity == null
            ? Number.MAX_SAFE_INTEGER
            : Number(tier.max_quantity);
        const tierRate = Number(tier.rate);
        const tierQuantity = Math.min(remainingQuantity, tierMax - tierMin + 1);

        if (tierQuantity > 0) {
          const tierAmount = Math.ceil(tierQuantity * tierRate);
          total += tierAmount;
          remainingQuantity -= tierQuantity;
          tierSteps.push(
            `${formatQuantity(tierQuantity)} × ${formatCents(tierRate, contractCurrency)} = ${formatCents(tierAmount, contractCurrency)}`,
          );
        }
      }
    }

    const { taxRegion: serviceTaxRegion, isTaxable } =
      taxPorts.getTaxInfoFromService({
        service_id: record.service_id,
        tax_rate_id: record.tax_rate_id,
      });
    const effectiveTaxRegion =
      serviceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
      undefined;

    let taxAmount = 0;
    let taxRate = 0;
    // Exemption is per billing profile (F131): one invoice can carry both
    // exempt and non-exempt lines when a client holds several legal entities.
    if (
      !taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) &&
      isTaxable &&
      effectiveTaxRegion
    ) {
      try {
        const taxResult = taxPorts.calculateTax(
          client.client_id,
          total,
          billingPeriod.endDate,
          effectiveTaxRegion,
          true,
          clientContractLine.currency_code || "USD",
          resolvedProfile?.billingProfileId ?? null,
        );
        taxRate = taxResult.taxRate;
        taxAmount = taxResult.taxAmount;
      } catch (error) {
        console.error(
          `Error calculating initial tax for usage record ${record.usage_id}:`,
          error,
        );
      }
    }

    const serviceName = record.service_name ?? "Usage";
    const markers: ChargeExplanation["markers"] = [];
    if (minimumApplied) markers.push("minimum_applied");
    if (tiered) markers.push("rate_tier");
    const steps = tiered
      ? [...tierSteps, `Total = ${formatCents(total, contractCurrency)}`]
      : [
          `${formatQuantity(quantity)} × ${formatCents(rate, contractCurrency)} = ${formatCents(total, contractCurrency)}`,
        ];
    explanations.push({
      chargeKey: `${serviceConfig?.config.config_id ?? clientContractLine.client_contract_line_id}:${record.service_id}:${record.usage_id}`,
      serviceName,
      chargeType: "usage",
      inputs: [
        { label: "Usage", value: formatQuantity(quantity) },
        ...(tiered
          ? [
              {
                label: "Pricing",
                value: `${serviceConfig?.rateTiers.length ?? 0} tiers`,
              },
            ]
          : [{ label: "Rate", value: formatCents(rate, contractCurrency) }]),
      ],
      steps,
      ...(minimumApplied
        ? {
            note: `Minimum usage applied: ${formatQuantity(rawQuantity)} → ${formatQuantity(quantity)}`,
          }
        : {}),
      markers,
    });

    return {
      serviceId: record.service_id,
      config_id: serviceConfig?.config.config_id,
      serviceName,
      client_contract_line_id: clientContractLine.client_contract_line_id,
      quantity,
      rate,
      total,
      tax_region: effectiveTaxRegion,
      type: "usage",
      tax_amount: taxAmount,
      tax_rate: taxRate,
      usageId: record.usage_id,
      is_taxable: isTaxable,
      servicePeriodStart: timing.servicePeriodStart,
      servicePeriodEnd: timing.servicePeriodEnd,
      servicePeriodRecordId: timing.servicePeriodRecordId ?? null,
      billingTiming: timing.duePosition,
      client_contract_id: clientContractLine.client_contract_id || undefined,
      contract_name: clientContractLine.contract_name || undefined,
      location_id: clientContractLine.location_id ?? null,
      billing_profile_id: resolvedProfile?.billingProfileId ?? null,
      billing_profile_source: resolvedProfile?.source ?? null,
    };
  });

  return { charges, explanations };
}
