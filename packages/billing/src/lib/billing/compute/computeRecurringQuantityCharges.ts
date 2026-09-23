import type {
  ChargeExplanation,
  IClientContractLine,
  ILicenseCharge,
  IProductCharge,
} from "@alga-psa/types";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeComputeTiming,
  ChargeProfileAssignments,
} from "./types";
import { resolveChargeProfileFor } from "../billingProfileResolution";

/**
 * Effective pricing selected from a scheduled revision for the covered service
 * period. Presence means the item is on the strict, revision-billing path:
 * quantity zero is a real zero, catalog policy needs a currency price only when
 * there are billable units, and the source is attributable back to the revision.
 */
export interface RecurringQuantityEffectivePricing {
  quantity: number;
  pricePolicy: "override" | "catalog";
  unitRateCents: number | null;
  revisionId: string;
  version: number;
  effectivePeriodStart: string;
}

export interface RecurringQuantityServiceRow {
  service_id: string;
  service_name: string;
  default_rate?: number | string | null;
  tax_rate_id?: string | null;
  config_id?: string | null;
  service_quantity?: number | string | null;
  service_line_custom_rate?: number | string | null;
  configuration_quantity?: number | string | null;
  configuration_custom_rate?: number | string | null;
  /** Currency-specific service_prices row. */
  price_rate?: number | string | null;
  /** Set by the engine when a scheduled revision applies to this period. */
  effective_pricing?: RecurringQuantityEffectivePricing | null;
}

export interface RecurringQuantityChargeComputeInputs {
  clientContractLine: IClientContractLine;
  client: ChargeComputeClient;
  timing: ChargeComputeTiming;
  chargeType: "product" | "license";
  services: RecurringQuantityServiceRow[];
  contractCurrency: string;
  /**
   * Recurring product/license charges have no per-occurrence source record, so
   * they stop at the contract step of the resolution chain (F028).
   */
  billingProfile?: ChargeProfileAssignments | null;
}

export interface RecurringQuantityChargeComputeResult {
  charges: Array<IProductCharge | ILicenseCharge>;
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

export function computeRecurringQuantityCharges(
  inputs: RecurringQuantityChargeComputeInputs,
  taxPorts: ChargeComputeTaxPorts,
): RecurringQuantityChargeComputeResult {
  const {
    clientContractLine,
    client,
    timing,
    chargeType,
    services,
    contractCurrency,
    billingProfile,
  } = inputs;
  const resolvedProfile = resolveChargeProfileFor(billingProfile);
  const explanations: ChargeExplanation[] = [];

  const charges = services.map((service): IProductCharge | ILicenseCharge => {
    const missingPriceMessage =
      `Missing pricing for ${chargeType} "${service.service_name}" (${service.service_id}) in ${contractCurrency}. ` +
      `Add a ${contractCurrency} price in the product catalog or set a custom rate on the contract line.`;

    const effective = service.effective_pricing ?? null;
    let quantity: number;
    let originalRate: number;
    let rateSource: string;
    let revisionApplied = false;

    if (effective) {
      revisionApplied = true;
      const rawQuantity = Number(effective.quantity);
      quantity =
        Number.isFinite(rawQuantity) && rawQuantity > 0
          ? Math.round(rawQuantity)
          : Math.max(0, Math.round(Number.isFinite(rawQuantity) ? rawQuantity : 0));

      if (effective.pricePolicy === "override") {
        const explicitRate =
          effective.unitRateCents === null || effective.unitRateCents === undefined
            ? null
            : Number(effective.unitRateCents);
        if (quantity === 0) {
          // A stopped item needs no rate to reach a deliberate zero outcome.
          originalRate = explicitRate !== null && Number.isFinite(explicitRate) ? Math.round(explicitRate) : 0;
          rateSource = "scheduled override";
        } else if (
          explicitRate === null ||
          !Number.isFinite(explicitRate) ||
          explicitRate < 0
        ) {
          throw new Error(
            `Scheduled revision ${effective.revisionId} for ${chargeType} "${service.service_name}" (${service.service_id}) has no valid unit rate override.`,
          );
        } else {
          originalRate = Math.round(explicitRate);
          rateSource = "scheduled override";
        }
      } else {
        const catalogRate =
          service.price_rate === null || service.price_rate === undefined
            ? null
            : Number(service.price_rate);
        if (quantity === 0) {
          // A stopped item must not be blocked by a missing catalog price.
          originalRate = catalogRate !== null && Number.isFinite(catalogRate) ? Math.round(catalogRate) : 0;
          rateSource = "scheduled catalog price";
        } else if (catalogRate === null || !Number.isFinite(catalogRate)) {
          throw new Error(missingPriceMessage);
        } else {
          originalRate = Math.round(catalogRate);
          rateSource = "scheduled catalog price";
        }
      }
    } else {
      // Legacy path: untouched products keep their exact prior behavior,
      // including the historical zero/null -> one coercion. Strict zero only
      // applies once an item has an explicit scheduled revision.
      const hasOverride =
        service.configuration_custom_rate != null ||
        service.service_line_custom_rate != null;
      const hasCatalogPrice = service.price_rate != null;
      if (!hasOverride && !hasCatalogPrice) {
        throw new Error(missingPriceMessage);
      }

      const rateCandidate =
        service.configuration_custom_rate ??
        service.service_line_custom_rate ??
        service.price_rate ??
        service.default_rate ??
        0;
      originalRate = Math.round(Number(rateCandidate) || 0);
      const quantityCandidate =
        service.configuration_quantity ?? service.service_quantity ?? 1;
      quantity = Math.max(1, Math.round(Number(quantityCandidate) || 1));
      rateSource =
        service.configuration_custom_rate != null
          ? "configuration override"
          : service.service_line_custom_rate != null
            ? "service override"
            : "currency catalog price";
    }

    const originalTotal = originalRate * quantity;

    const { taxRegion: serviceTaxRegion, isTaxable } =
      taxPorts.getTaxInfoFromService({
        service_id: service.service_id,
        tax_rate_id: service.tax_rate_id,
      });
    const effectiveTaxRegion =
      serviceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
      undefined;

    let originalTaxAmount = 0;
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
          originalTotal,
          timing.servicePeriodEnd,
          effectiveTaxRegion,
          true,
          contractCurrency,
          resolvedProfile?.billingProfileId ?? null,
        );
        taxRate = taxResult.taxRate;
        originalTaxAmount = taxResult.taxAmount;
      } catch (error) {
        console.error(
          `Error calculating initial tax for ${chargeType} service ${service.service_id}:`,
          error,
        );
      }
    }

    // Zero quantity is a deliberate stop: no monetary charge, no division by
    // zero, and no coincidence with proration. Coverage proration only applies
    // while there are billable units.
    const shouldProrate =
      Boolean(clientContractLine.enable_proration) && quantity > 0;
    const coverageRatio = shouldProrate
      ? Math.max(0, Math.min(timing.coverageRatio, 1))
      : 1;
    const proratedTotal = Math.ceil(Math.ceil(originalTotal) * coverageRatio);
    const rate =
      quantity === 0
        ? 0
        : shouldProrate
          ? Math.ceil(proratedTotal / quantity)
          : originalRate;
    const total = quantity === 0 ? 0 : rate * quantity;
    const taxAmount =
      quantity === 0
        ? 0
        : shouldProrate
          ? Math.ceil(Math.ceil(originalTaxAmount) * coverageRatio)
          : originalTaxAmount;

    const charge: IProductCharge | ILicenseCharge = {
      type: chargeType,
      serviceId: service.service_id,
      config_id: service.config_id ?? undefined,
      client_contract_line_id: clientContractLine.client_contract_line_id,
      serviceName: service.service_name,
      quantity,
      rate,
      total,
      tax_amount: taxAmount,
      tax_rate: taxRate,
      tax_region: effectiveTaxRegion,
      is_taxable: isTaxable,
      servicePeriodStart: timing.servicePeriodStart,
      servicePeriodEnd: timing.servicePeriodEnd,
      servicePeriodRecordId: timing.servicePeriodRecordId ?? null,
      billingTiming: clientContractLine.billing_timing ?? "arrears",
      client_contract_id: clientContractLine.client_contract_id || undefined,
      contract_name: clientContractLine.contract_name || undefined,
      location_id: clientContractLine.location_id ?? null,
      billing_profile_id: resolvedProfile?.billingProfileId ?? null,
      billing_profile_source: resolvedProfile?.source ?? null,
      ...(chargeType === "license"
        ? {
            period_start: timing.servicePeriodStart,
            period_end: timing.servicePeriodEnd,
          }
        : {}),
    };

    const markers: ChargeExplanation["markers"] = [];
    if (shouldProrate && coverageRatio < 1) markers.push("proration");
    if (quantity === 0) markers.push("zero_quantity");
    if (revisionApplied) markers.push("scheduled_revision");
    explanations.push({
      chargeKey: `${service.config_id ?? clientContractLine.client_contract_line_id}:${service.service_id}`,
      serviceName: service.service_name,
      chargeType,
      inputs: [
        { label: "Quantity", value: formatQuantity(quantity) },
        { label: "Rate", value: formatCents(originalRate, contractCurrency) },
        { label: "Rate source", value: rateSource },
        ...(shouldProrate
          ? [
              {
                label: "Coverage",
                value: `${(coverageRatio * 100).toFixed(2)}%`,
              },
            ]
          : []),
      ],
      steps: [
        `${formatQuantity(quantity)} × ${formatCents(originalRate, contractCurrency)} = ${formatCents(originalTotal, contractCurrency)}`,
        ...(shouldProrate && coverageRatio < 1
          ? [
              `${formatCents(originalTotal, contractCurrency)} × ${(coverageRatio * 100).toFixed(2)}% = ${formatCents(total, contractCurrency)}`,
            ]
          : []),
      ],
      note:
        quantity === 0
          ? "Stopped for this service period: zero units, so no recurring charge is due."
          : shouldProrate && coverageRatio < 1
            ? "Prorated to the covered portion of the service period."
            : undefined,
      markers,
    });

    return charge;
  });

  return { charges, explanations };
}
