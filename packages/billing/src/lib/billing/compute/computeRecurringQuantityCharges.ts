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
} from "./types";

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
}

export interface RecurringQuantityChargeComputeInputs {
  clientContractLine: IClientContractLine;
  client: ChargeComputeClient;
  timing: ChargeComputeTiming;
  chargeType: "product" | "license";
  services: RecurringQuantityServiceRow[];
  contractCurrency: string;
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
  } = inputs;
  const explanations: ChargeExplanation[] = [];

  const charges = services.map((service): IProductCharge | ILicenseCharge => {
    const hasOverride =
      service.configuration_custom_rate != null ||
      service.service_line_custom_rate != null;
    const hasCatalogPrice = service.price_rate != null;
    if (!hasOverride && !hasCatalogPrice) {
      throw new Error(
        `Missing pricing for ${chargeType} "${service.service_name}" (${service.service_id}) in ${contractCurrency}. ` +
          `Add a ${contractCurrency} price in the product catalog or set a custom rate on the contract line.`,
      );
    }

    const rateCandidate =
      service.configuration_custom_rate ??
      service.service_line_custom_rate ??
      service.price_rate ??
      service.default_rate ??
      0;
    const originalRate = Math.round(Number(rateCandidate) || 0);
    const quantityCandidate =
      service.configuration_quantity ?? service.service_quantity ?? 1;
    const quantity = Math.max(1, Math.round(Number(quantityCandidate) || 1));
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
    if (!client.is_tax_exempt && isTaxable && effectiveTaxRegion) {
      try {
        const taxResult = taxPorts.calculateTax(
          client.client_id,
          originalTotal,
          timing.servicePeriodEnd,
          effectiveTaxRegion,
          true,
          clientContractLine.currency_code || "USD",
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

    const shouldProrate = Boolean(clientContractLine.enable_proration);
    const coverageRatio = shouldProrate
      ? Math.max(0, Math.min(timing.coverageRatio, 1))
      : 1;
    const proratedTotal = Math.ceil(Math.ceil(originalTotal) * coverageRatio);
    const rate = shouldProrate
      ? Math.ceil(proratedTotal / quantity)
      : originalRate;
    const total = rate * quantity;
    const taxAmount = shouldProrate
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
      ...(chargeType === "license"
        ? {
            period_start: timing.servicePeriodStart,
            period_end: timing.servicePeriodEnd,
          }
        : {}),
    };

    const markers: ChargeExplanation["markers"] = [];
    if (shouldProrate && coverageRatio < 1) markers.push("proration");
    const rateSource =
      service.configuration_custom_rate != null
        ? "configuration override"
        : service.service_line_custom_rate != null
          ? "service override"
          : "currency catalog price";
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
        shouldProrate && coverageRatio < 1
          ? "Prorated to the covered portion of the service period."
          : undefined,
      markers,
    });

    return charge;
  });

  return { charges, explanations };
}
