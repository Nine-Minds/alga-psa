import { Temporal } from "@js-temporal/polyfill";
import type {
  ChargeExplanation,
  IBillingPeriod,
  IClientContractLine,
  IFixedPriceCharge,
  ISO8601String,
} from "@alga-psa/types";
import { toPlainDate } from "@alga-psa/core";
import type {
  ChargeComputeClient,
  ChargeComputeTaxPorts,
  ChargeComputeTiming,
  ChargeProfileAssignments,
} from "./types";
import { resolveChargeProfileFor } from "../billingProfileResolution";

/**
 * Fixed-charge math extracted from BillingEngine.calculateFixedPriceCharges.
 * The engine's load phase supplies the rows below; this module reproduces the
 * original charge arithmetic byte-for-byte (allocation, proration, settlement,
 * advance-window suppression by end date) with zero I/O outside the injected
 * tax ports.
 */

export interface FixedPlanServiceRow {
  service_id: string;
  service_name: string;
  default_rate: number | string | null;
  tax_rate_id: string | null;
  config_id: string;
  service_quantity?: number | string | null;
  service_line_custom_rate?: unknown;
  configuration_quantity?: number | string | null;
  configuration_custom_rate?: unknown;
  service_base_rate: number | string | null;
  enable_proration?: boolean | null;
  quantity?: number | string | null;
}

export interface FixedFallbackServiceRow {
  service_id: string;
  service_name: string | null;
  tax_rate_id: string | null;
  config_id: string;
}

export interface FixedChargeComputeInputs {
  clientId: string;
  billingPeriod: IBillingPeriod;
  clientContractLine: IClientContractLine;
  timing: ChargeComputeTiming;
  client: ChargeComputeClient;
  /** contract_lines row for the line (contract_line_type, custom_rate, enable_proration). */
  contractLineDetails:
    | {
        contract_line_type?: string | null;
        custom_rate?: number | string | null;
        enable_proration?: boolean | null;
      }
    | undefined;
  /**
   * Assignment custom rate after any pricing-schedule override has been
   * applied by the loader (cents).
   */
  effectiveCustomRate: number | string | null | undefined;
  /** Where effectiveCustomRate came from; explanation-only. */
  customRateSource: "pricing_schedule" | "assignment" | null;
  planServices: FixedPlanServiceRow[];
  /** Loaded by the caller when planServices is empty; null otherwise. */
  fallbackService: FixedFallbackServiceRow | null;
  /**
   * Fixed charges have no per-occurrence source record — there is only the
   * contract line and its recurring periods — so they stop at the contract
   * step of the resolution chain (F026, documented via F070).
   */
  billingProfile?: ChargeProfileAssignments | null;
}

export interface FixedChargeComputeResult {
  charges: IFixedPriceCharge[];
  explanations: ChargeExplanation[];
  /**
   * Set when the surviving charges bill an advance service period that may
   * already be persisted. Production must suppress the charges when a
   * matching persisted charge exists; the simulator has nothing persisted
   * and ignores this.
   */
  advanceGuard: {
    servicePeriodStart: ISO8601String;
    servicePeriodEnd: ISO8601String;
  } | null;
}

export function shouldApplyAdvanceTerminationCoverageSettlement(
  clientContractLine: IClientContractLine,
  billingPeriod: IBillingPeriod,
  billingTiming: "arrears" | "advance",
  coverageRatio: number,
): boolean {
  if (
    billingTiming !== "advance" ||
    !clientContractLine.end_date ||
    coverageRatio >= 1
  ) {
    return false;
  }

  const lineEndExclusive = toPlainDate(clientContractLine.end_date).add({
    days: 1,
  });
  const currentPeriodEndExclusive = toPlainDate(billingPeriod.endDate);
  return (
    Temporal.PlainDate.compare(lineEndExclusive, currentPeriodEndExclusive) < 0
  );
}

export function settleFixedChargeAmount(
  amount: number,
  coverageRatio: number,
  roundingMode: "coverage_ratio" | "unused_credit_net",
): number {
  if (!Number.isFinite(amount) || amount === 0) {
    return 0;
  }

  const boundedCoverageRatio = Math.max(0, Math.min(coverageRatio, 1));
  const sign = amount < 0 ? -1 : 1;
  const absoluteAmount = Math.abs(amount);

  if (roundingMode === "unused_credit_net") {
    const unusedRatio = 1 - boundedCoverageRatio;
    return sign * (absoluteAmount - Math.round(absoluteAmount * unusedRatio));
  }

  return sign * Math.round(absoluteAmount * boundedCoverageRatio);
}

export function applyFixedChargeCoverageSettlement(
  charges: IFixedPriceCharge[],
  coverageRatio: number,
  roundingMode: "coverage_ratio" | "unused_credit_net",
): IFixedPriceCharge[] {
  return charges
    .map((charge) => {
      const settledTotal = settleFixedChargeAmount(
        charge.total ?? 0,
        coverageRatio,
        roundingMode,
      );
      const settledTax = settleFixedChargeAmount(
        charge.tax_amount ?? 0,
        coverageRatio,
        roundingMode,
      );
      const settledRate = settleFixedChargeAmount(
        charge.rate ?? charge.total ?? 0,
        coverageRatio,
        roundingMode,
      );
      const settledAllocatedAmount =
        charge.allocated_amount === undefined
          ? undefined
          : settleFixedChargeAmount(
              charge.allocated_amount,
              coverageRatio,
              roundingMode,
            );

      if (settledTotal === 0 && settledTax === 0) {
        return null;
      }

      return {
        ...charge,
        total: settledTotal,
        tax_amount: settledTax,
        rate: settledRate,
        ...(settledAllocatedAmount === undefined
          ? {}
          : { allocated_amount: settledAllocatedAmount }),
      };
    })
    .filter((charge): charge is IFixedPriceCharge => charge !== null);
}

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

function fixedChargeKey(charge: IFixedPriceCharge): string {
  return `${charge.config_id ?? charge.client_contract_line_id ?? "line"}:${charge.serviceId ?? "service"}`;
}

export function computeFixedCharges(
  inputs: FixedChargeComputeInputs,
  taxPorts: ChargeComputeTaxPorts,
): FixedChargeComputeResult {
  const {
    clientId,
    billingPeriod,
    clientContractLine,
    timing,
    client,
    contractLineDetails,
    effectiveCustomRate,
    customRateSource,
    planServices,
    fallbackService,
    billingProfile,
  } = inputs;
  const resolvedProfile = resolveChargeProfileFor(billingProfile);

  const {
    duePosition: lineBillingTiming,
    servicePeriodStart,
    servicePeriodEnd,
    coverageRatio,
  } = timing;
  const currencyCode = clientContractLine.currency_code || "USD";

  let fixedProrationEnabled = false;
  let generatedCharges: IFixedPriceCharge[] | null = null;
  let generatedChargeAmountsUseCoverage = false;
  const explanations: ChargeExplanation[] = [];

  const isFixedFeePlan = contractLineDetails?.contract_line_type === "Fixed";

  // --- Plan-level fixed config (base rate and proration) ---
  let planLevelBaseRate: number | null = null; // dollars
  let planLevelEnableProration = false;

  if (isFixedFeePlan && contractLineDetails) {
    if (
      contractLineDetails.custom_rate !== undefined &&
      contractLineDetails.custom_rate !== null
    ) {
      const parsedContractRate =
        typeof contractLineDetails.custom_rate === "string"
          ? parseFloat(contractLineDetails.custom_rate)
          : Number(contractLineDetails.custom_rate);
      if (!Number.isNaN(parsedContractRate)) {
        // custom_rate is stored in cents, convert to dollars for planLevelBaseRate
        planLevelBaseRate = parsedContractRate / 100;
      }
    }

    if (
      contractLineDetails.enable_proration !== undefined &&
      contractLineDetails.enable_proration !== null
    ) {
      planLevelEnableProration = Boolean(contractLineDetails.enable_proration);
    }
    fixedProrationEnabled = planLevelEnableProration;
  }

  if (isFixedFeePlan) {
    if (planLevelBaseRate === null && clientContractLine.custom_rate != null) {
      const parsedAssignmentRate =
        typeof clientContractLine.custom_rate === "string"
          ? parseFloat(clientContractLine.custom_rate)
          : Number(clientContractLine.custom_rate);
      if (!Number.isNaN(parsedAssignmentRate)) {
        planLevelBaseRate = parsedAssignmentRate / 100;
      }
    }
  }

  const normalizedPlanServices = planServices.map((service) => {
    const quantityValue =
      service.configuration_quantity ??
      service.service_quantity ??
      service.quantity ??
      1;
    return {
      ...service,
      quantity: Number(quantityValue ?? 1) || 1,
    };
  });

  if (!planLevelEnableProration) {
    const prorationFromService = planServices.find(
      (service) => service.enable_proration,
    );
    if (prorationFromService?.enable_proration) {
      planLevelEnableProration = Boolean(prorationFromService.enable_proration);
    }
  }
  fixedProrationEnabled = planLevelEnableProration;

  if (
    isFixedFeePlan &&
    (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))
  ) {
    let derivedBaseRate = 0;
    let hasServiceBaseRate = false;

    for (const service of planServices) {
      const rawServiceBaseRate = service.service_base_rate;
      if (rawServiceBaseRate !== null && rawServiceBaseRate !== undefined) {
        const parsedServiceBaseRate =
          typeof rawServiceBaseRate === "string"
            ? parseFloat(rawServiceBaseRate)
            : Number(rawServiceBaseRate);
        if (!Number.isNaN(parsedServiceBaseRate)) {
          const quantity =
            Number(
              service.configuration_quantity ?? service.service_quantity ?? 1,
            ) || 1;
          derivedBaseRate += parsedServiceBaseRate * quantity;
          hasServiceBaseRate = true;
        }
      }
    }

    if (hasServiceBaseRate) {
      // service_base_rate is stored in cents, convert to dollars
      planLevelBaseRate = derivedBaseRate / 100;
    }
  }

  if (
    isFixedFeePlan &&
    (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))
  ) {
    const totalDefaultRateCents = planServices.reduce(
      (sum: number, service) => {
        const rate = Number(service.default_rate ?? 0);
        const quantity =
          Number(
            service.configuration_quantity ?? service.service_quantity ?? 1,
          ) || 1;
        return sum + rate * quantity;
      },
      0,
    );
    if (totalDefaultRateCents !== 0) {
      planLevelBaseRate = totalDefaultRateCents / 100;
    }
  }

  if (
    isFixedFeePlan &&
    (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate))
  ) {
    console.error(
      `[DEBUG] Unable to determine base_rate for contract line ${clientContractLine.contract_line_id}.`,
    );
    return { charges: [], explanations: [], advanceGuard: null };
  }

  const planLevelBaseRateCents =
    planLevelBaseRate !== null && !Number.isNaN(planLevelBaseRate)
      ? Math.round(planLevelBaseRate * 100)
      : null;

  const hasCustomRateOverride =
    effectiveCustomRate !== null &&
    effectiveCustomRate !== undefined &&
    (planLevelBaseRateCents === null ||
      Math.round(Number(effectiveCustomRate)) !== planLevelBaseRateCents);

  if (planServices.length === 0) {
    if (!isFixedFeePlan || planLevelBaseRateCents === null) {
      return { charges: [], explanations: [], advanceGuard: null };
    }

    const baseRateInCents = hasCustomRateOverride
      ? Math.round(Number(effectiveCustomRate))
      : planLevelBaseRateCents;

    if (!fallbackService?.service_id || !fallbackService?.config_id) {
      return { charges: [], explanations: [], advanceGuard: null };
    }

    const {
      taxRegion: fallbackServiceTaxRegion,
      isTaxable: fallbackIsTaxable,
    } = taxPorts.getTaxInfoFromService(fallbackService);
    const fallbackTaxRegion =
      fallbackServiceTaxRegion ??
      taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
      taxPorts.getClientDefaultTaxRegionCode(client.client_id);
    let fallbackTaxAmount = 0;
    let fallbackTaxRate = 0;
    if (!client.is_tax_exempt && fallbackIsTaxable && fallbackTaxRegion) {
      const taxResult = taxPorts.calculateTax(
        client.client_id,
        baseRateInCents,
        servicePeriodEnd,
        fallbackTaxRegion,
        true,
        currencyCode,
      );
      fallbackTaxRate = taxResult.taxRate;
      fallbackTaxAmount = taxResult.taxAmount;
    }

    generatedCharges = [
      {
        type: "fixed",
        serviceId: fallbackService.service_id,
        config_id: fallbackService.config_id,
        serviceName:
          fallbackService.service_name ||
          clientContractLine.contract_line_name ||
          "Fixed Plan Charge",
        quantity: 1,
        rate: baseRateInCents,
        total: baseRateInCents,
        tax_amount: fallbackTaxAmount,
        tax_rate: fallbackTaxRate,
        tax_region: fallbackTaxRegion ?? undefined,
        is_taxable: fallbackIsTaxable,
        client_contract_line_id: clientContractLine.client_contract_line_id,
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined,
        location_id: clientContractLine.location_id ?? null,
        billing_profile_id: resolvedProfile?.billingProfileId ?? null,
        billing_profile_source: resolvedProfile?.source ?? null,
        base_rate: baseRateInCents,
        enable_proration: planLevelEnableProration,
        fmv: baseRateInCents,
        proportion: 1,
        allocated_amount: baseRateInCents,
      },
    ];
    explanations.push({
      chargeKey: fixedChargeKey(generatedCharges[0]),
      serviceName: generatedCharges[0].serviceName,
      chargeType: "fixed",
      inputs: [
        {
          label: hasCustomRateOverride ? "Custom rate" : "Plan base rate",
          value: formatCents(baseRateInCents, currencyCode),
        },
      ],
      steps: [
        `${formatCents(baseRateInCents, currencyCode)} × 1 = ${formatCents(baseRateInCents, currencyCode)}`,
      ],
      note: "Fixed plan billed as a single consolidated charge.",
      markers:
        customRateSource === "pricing_schedule" && hasCustomRateOverride
          ? ["pricing_schedule_override"]
          : [],
    });
  }

  if (!generatedCharges && isFixedFeePlan) {
    // Consolidated fixed fee, internally allocated across services by FMV.
    const baseRateInCents = hasCustomRateOverride
      ? Math.round(Number(effectiveCustomRate))
      : Math.round(planLevelBaseRate! * 100);

    const totalFMVCents = normalizedPlanServices.reduce((sum, service) => {
      const serviceFMV = Number(service.default_rate ?? 0) * service.quantity;
      return sum + serviceFMV;
    }, 0);

    // Zero FMV cannot be allocated. Negative FMV is valid (credit services).
    if (totalFMVCents === 0) {
      console.log(
        `Total FMV (cents) for services in plan ${clientContractLine.contract_line_id} is zero`,
      );
      return { charges: [], explanations: [], advanceGuard: null };
    }

    const serviceAllocations = normalizedPlanServices.map((service) => {
      // FMV is based on the service's default rate (cents), not plan overrides.
      const rateForFMV = Number(service.default_rate || 0);
      const serviceFMVCents = Math.round(rateForFMV * service.quantity);

      const proportion =
        totalFMVCents !== 0 ? serviceFMVCents / totalFMVCents : 0;

      let prorationFactor = 1.0;
      let effectiveBaseRateInCents = baseRateInCents;
      if (planLevelEnableProration) {
        prorationFactor = coverageRatio;
        effectiveBaseRateInCents = Math.round(
          effectiveBaseRateInCents * prorationFactor,
        );
      }

      const allocatedAmount = Math.round(effectiveBaseRateInCents * proportion);

      const { taxRegion: serviceTaxRegion, isTaxable } =
        taxPorts.getTaxInfoFromService(service);

      let taxAmount = 0;
      let taxRate = 0;
      if (!client.is_tax_exempt && isTaxable) {
        const effectiveTaxRegion =
          serviceTaxRegion ??
          taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
          taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
          "";
        if (effectiveTaxRegion) {
          const taxResult = taxPorts.calculateTax(
            client.client_id,
            allocatedAmount,
            servicePeriodEnd,
            effectiveTaxRegion,
            true,
            currencyCode,
          );
          taxRate = taxResult.taxRate;
          taxAmount = taxResult.taxAmount;
        } else {
          console.warn(
            `[BillingEngine] No tax region found (from service tax_rate_id or client default via getClientDefaultTaxRegionCode) for service ${service.service_id} / client ${clientId}. Using zero tax rate.`,
          );
        }
      }

      return {
        serviceId: service.service_id,
        serviceName: service.service_name,
        fmv: serviceFMVCents,
        proportion,
        allocatedAmount,
        isTaxable,
        taxRate,
        taxAmount,
        prorationFactor,
        effectiveBaseRateInCents,
      };
    });

    const detailedCharges: IFixedPriceCharge[] = [];

    for (const allocation of serviceAllocations) {
      const planService = normalizedPlanServices.find(
        (ps) => ps.service_id === allocation.serviceId,
      );

      if (!planService) {
        console.warn(
          `Could not find planService data for serviceId: ${allocation.serviceId} in plan ${clientContractLine.contract_line_id}`,
        );
        continue;
      }

      const quantity = Number(planService.quantity ?? 1) || 1;

      const detailedCharge: IFixedPriceCharge = {
        type: "fixed",
        serviceId: allocation.serviceId,
        serviceName: allocation.serviceName,
        quantity,
        rate: allocation.allocatedAmount,
        total: allocation.allocatedAmount,
        tax_amount: allocation.taxAmount,
        tax_rate: allocation.taxRate,
        is_taxable: allocation.isTaxable,
        tax_region:
          taxPorts.getTaxInfoFromService(planService).taxRegion ??
          taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
          taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
          undefined,
        client_contract_line_id: clientContractLine.client_contract_line_id,
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined,
        location_id: clientContractLine.location_id ?? null,
        billing_profile_id: resolvedProfile?.billingProfileId ?? null,
        billing_profile_source: resolvedProfile?.source ?? null,
        config_id: planService.config_id,
        base_rate: baseRateInCents,
        enable_proration: planLevelEnableProration,
        fmv: allocation.fmv,
        proportion: allocation.proportion,
        allocated_amount: allocation.allocatedAmount,
      };
      detailedCharges.push(detailedCharge);

      const explanationInputs = [
        {
          label: hasCustomRateOverride ? "Custom plan rate" : "Plan base rate",
          value: formatCents(baseRateInCents, currencyCode),
        },
        {
          label: "Service FMV",
          value: formatCents(allocation.fmv, currencyCode),
        },
        {
          label: "FMV proportion",
          value: `×${allocation.proportion.toFixed(4)}`,
        },
      ];
      const steps: string[] = [];
      if (planLevelEnableProration) {
        explanationInputs.push({
          label: "Proration factor",
          value: `×${allocation.prorationFactor.toFixed(4)}`,
        });
        steps.push(
          `${formatCents(baseRateInCents, currencyCode)} × ${allocation.prorationFactor.toFixed(4)} = ${formatCents(allocation.effectiveBaseRateInCents, currencyCode)}`,
        );
      }
      steps.push(
        `${formatCents(allocation.effectiveBaseRateInCents, currencyCode)} × ${allocation.proportion.toFixed(4)} = ${formatCents(allocation.allocatedAmount, currencyCode)}`,
      );
      const markers: ChargeExplanation["markers"] = [];
      if (planLevelEnableProration && allocation.prorationFactor !== 1) {
        markers.push("proration");
      }
      if (normalizedPlanServices.length > 1) {
        markers.push("fmv_allocation");
      }
      if (customRateSource === "pricing_schedule" && hasCustomRateOverride) {
        markers.push("pricing_schedule_override");
      }
      explanations.push({
        chargeKey: fixedChargeKey(detailedCharge),
        serviceName: allocation.serviceName,
        chargeType: "fixed",
        inputs: explanationInputs,
        steps,
        note:
          normalizedPlanServices.length > 1
            ? "The plan's fixed fee is allocated across its services in proportion to their fair market value."
            : planLevelEnableProration && allocation.prorationFactor !== 1
              ? "Prorated — the service period covers part of the billing period."
              : undefined,
        markers,
      });
    }

    generatedCharges = detailedCharges;
    generatedChargeAmountsUseCoverage = planLevelEnableProration;
  } else if (!generatedCharges) {
    // Plan type isn't 'Fixed' but a service within it is configured Fixed.
    console.warn(
      `[BillingEngine] Processing fixed service config for a non-fixed plan type (${contractLineDetails?.contract_line_type}) for plan ${clientContractLine.contract_line_id}. Review this logic.`,
    );

    const fixedCharges: IFixedPriceCharge[] = normalizedPlanServices.map(
      (service): IFixedPriceCharge => {
        const quantity = service.quantity;

        const parsedBaseRate =
          service.service_base_rate !== null &&
          service.service_base_rate !== undefined
            ? Number(service.service_base_rate)
            : null;
        // service_base_rate is already stored in cents
        const baseRateInCents =
          parsedBaseRate !== null && !Number.isNaN(parsedBaseRate)
            ? Math.round(parsedBaseRate)
            : Number(service.default_rate ?? 0);
        const total = baseRateInCents * quantity;

        const { taxRegion: serviceTaxRegion, isTaxable } =
          taxPorts.getTaxInfoFromService(service);

        const charge: IFixedPriceCharge = {
          serviceId: service.service_id,
          serviceName: service.service_name,
          quantity,
          rate: baseRateInCents,
          total,
          type: "fixed",
          client_contract_line_id: clientContractLine.client_contract_line_id,
          client_contract_id:
            clientContractLine.client_contract_id || undefined,
          contract_name: clientContractLine.contract_name || undefined,
          location_id: clientContractLine.location_id ?? null,
          billing_profile_id: resolvedProfile?.billingProfileId ?? null,
          billing_profile_source: resolvedProfile?.source ?? null,
          tax_amount: 0,
          tax_rate: 0,
          tax_region:
            serviceTaxRegion ??
            taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
            taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
            undefined,
          is_taxable: isTaxable,
          enable_proration: planLevelEnableProration,
          config_id: service.config_id,
          base_rate: baseRateInCents,
        };
        if (!client.is_tax_exempt && charge.is_taxable) {
          const effectiveTaxRegion = charge.tax_region ?? "";
          if (effectiveTaxRegion) {
            const taxResult = taxPorts.calculateTax(
              client.client_id,
              charge.total,
              servicePeriodEnd,
              effectiveTaxRegion,
              true,
              currencyCode,
            );
            charge.tax_rate = taxResult.taxRate;
            charge.tax_amount = taxResult.taxAmount;
          } else {
            console.warn(
              `No effective tax region found for edge-case fixed service ${service.service_id}, using zero tax rate`,
            );
            charge.tax_rate = 0;
            charge.tax_amount = 0;
          }
        } else {
          console.warn(
            `No effective tax region found for edge-case fixed service ${service.service_id}, using zero tax rate`,
          );
          charge.tax_rate = 0;
          charge.tax_amount = 0;
        }

        explanations.push({
          chargeKey: fixedChargeKey(charge),
          serviceName: service.service_name,
          chargeType: "fixed",
          inputs: [
            {
              label: "Service rate",
              value: formatCents(baseRateInCents, currencyCode),
            },
            { label: "Quantity", value: String(quantity) },
          ],
          steps: [
            `${formatCents(baseRateInCents, currencyCode)} × ${quantity} = ${formatCents(total, currencyCode)}`,
          ],
          markers: [],
        });

        return charge;
      },
    );

    generatedCharges = fixedCharges;
  }

  if (!generatedCharges || generatedCharges.length === 0) {
    return { charges: [], explanations: [], advanceGuard: null };
  }

  const requiresAdvanceTerminationSettlement =
    shouldApplyAdvanceTerminationCoverageSettlement(
      clientContractLine,
      billingPeriod,
      lineBillingTiming,
      coverageRatio,
    );
  const settlementApplied =
    !generatedChargeAmountsUseCoverage &&
    (fixedProrationEnabled || requiresAdvanceTerminationSettlement);
  const chargesAfterSettlement = settlementApplied
    ? applyFixedChargeCoverageSettlement(
        generatedCharges,
        coverageRatio,
        requiresAdvanceTerminationSettlement
          ? "unused_credit_net"
          : "coverage_ratio",
      )
    : generatedCharges;

  const chargesWithMeta = chargesAfterSettlement.map((charge) => ({
    ...charge,
    servicePeriodRecordId: timing.servicePeriodRecordId ?? null,
    servicePeriodStart,
    servicePeriodEnd,
    billingTiming: lineBillingTiming,
  }));

  let positiveCharges: IFixedPriceCharge[] = chargesWithMeta;
  let advanceGuard: FixedChargeComputeResult["advanceGuard"] = null;

  if (lineBillingTiming === "advance") {
    const endedBeforeAdvance = clientContractLine.end_date
      ? Temporal.PlainDate.compare(
          toPlainDate(clientContractLine.end_date),
          toPlainDate(servicePeriodStart),
        ) < 0
      : false;

    if (endedBeforeAdvance) {
      console.log(
        `[BillingEngine] Skipping advance billing for contract line ${clientContractLine.contract_line_id}: line ends before next period`,
      );
      positiveCharges = [];
    } else {
      advanceGuard = { servicePeriodStart, servicePeriodEnd };
    }
  }

  if (settlementApplied) {
    const survivingKeys = new Set(positiveCharges.map(fixedChargeKey));
    for (const explanation of explanations) {
      if (survivingKeys.has(explanation.chargeKey)) {
        explanation.steps.push(
          `Coverage settlement applied at ×${Math.max(0, Math.min(coverageRatio, 1)).toFixed(4)} of the period.`,
        );
        explanation.markers.push("cadence_settlement");
      }
    }
  }

  const finalKeys = new Set(positiveCharges.map(fixedChargeKey));
  return {
    charges: positiveCharges,
    explanations: explanations.filter((explanation) =>
      finalKeys.has(explanation.chargeKey),
    ),
    advanceGuard: positiveCharges.length > 0 ? advanceGuard : null,
  };
}
