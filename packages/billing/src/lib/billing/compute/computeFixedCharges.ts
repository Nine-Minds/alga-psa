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
  /**
   * Effective `service_prices.rate` for the contract's currency. Preferred over
   * the currency-untagged legacy `default_rate` so a non-USD contract bills its
   * own catalog price (correction #5).
   */
  currency_rate?: number | string | null;
  tax_rate_id: string | null;
  config_id: string;
  service_quantity?: number | string | null;
  service_line_custom_rate?: unknown;
  configuration_quantity?: number | string | null;
  configuration_custom_rate?: unknown;
  service_base_rate: number | string | null;
  enable_proration?: boolean | null;
  quantity?: number | string | null;
  /**
   * Explicit pricing basis of the member's fixed configuration:
   * 'unit' (recurring seat: quantity × base_rate) or 'bundle'/NULL (existing
   * fixed-bundle semantics where the line total is authoritative).
   */
  pricing_basis?: 'unit' | 'bundle' | string | null;
  /** Set by the engine when a scheduled unit revision applies to this period. */
  effective_pricing?: {
    quantity: number;
    pricePolicy: 'override' | 'catalog';
    unitRateCents: number | null;
    revisionId: string;
    version: number;
    effectivePeriodStart: string;
    catalogPriceId?: string | null;
    catalogEffectiveDate?: string | null;
  } | null;
}

/**
 * Pricing basis is per SERVICE, never per line: only members explicitly opted
 * into 'unit' bill quantity × unit rate. A NULL/legacy or 'bundle' sibling on
 * the same line keeps the fixed-bundle semantics (line total allocated by
 * FMV) — marking one member as recurring seats never reinterprets the others.
 */
export function isUnitPricedFixedService(service: Pick<FixedPlanServiceRow, "pricing_basis">): boolean {
  return service.pricing_basis === "unit";
}

/**
 * The catalog rate to price with: the effective, currency-tagged
 * `service_prices` rate when present, otherwise the legacy `default_rate`.
 * Returns 0 for "no rate" so callers that already treat 0 as absent keep their
 * existing shape.
 */
function preferredCatalogRate(
  service: Pick<FixedPlanServiceRow, "currency_rate" | "default_rate">,
): number {
  const raw = service.currency_rate ?? service.default_rate;
  const parsed = typeof raw === "string" ? parseFloat(raw) : Number(raw ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** True when the line has at least one explicitly unit-priced member. */
export function hasUnitPricedFixedMembers(planServices: FixedPlanServiceRow[]): boolean {
  return planServices.some((service) => isUnitPricedFixedService(service));
}

/**
 * @deprecated Line-level predicate kept only for callers that need "the line
 * has unit members and nothing bundled". Charge math is per service — see
 * {@link isUnitPricedFixedService}.
 */
export function isUnitPricedFixedLine(planServices: FixedPlanServiceRow[]): boolean {
  return (
    planServices.length > 0 &&
    planServices.every(
      (service) =>
        service.pricing_basis === undefined ||
        service.pricing_basis === null ||
        service.pricing_basis === "unit",
    ) &&
    planServices.some((service) => service.pricing_basis === "unit")
  );
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
   * True when planServices is empty because every member of the line is a
   * product/license, which bills through its own charge family. Such a line is
   * not "unpriceable" or "without services" — it just has nothing to bill as a
   * fixed fee — so the blockers must not fire for it.
   */
  hasProductMembers?: boolean;
  /**
   * Fixed charges have no per-occurrence source record — there is only the
   * contract line and its recurring periods — so they stop at the contract
   * step of the resolution chain (F026, documented via F070).
   */
  billingProfile?: ChargeProfileAssignments | null;
}

/**
 * Coded reason a fixed line could not be priced. Unresolved is NOT zero: a
 * line whose rate legitimately resolves to 0 is not a blocker and bills
 * nothing; a line whose rate cannot be determined at all must never vanish
 * from an invoice silently, so the caller refuses to preview/generate it.
 */
export const FIXED_LINE_RATE_UNRESOLVED = "FIXED_LINE_RATE_UNRESOLVED" as const;

/**
 * Coded reason a fixed line HAS a rate but nothing to bill it on: it has no
 * member services and no fallback service could be found. Distinct from
 * FIXED_LINE_RATE_UNRESOLVED (no rate at all), so its message must never say
 * "has no rate".
 */
export const FIXED_LINE_NO_SERVICES = "FIXED_LINE_NO_SERVICES" as const;

export type FixedChargeBlockerCode =
  | typeof FIXED_LINE_RATE_UNRESOLVED
  | typeof FIXED_LINE_NO_SERVICES;

export interface FixedChargeBlocker {
  code: FixedChargeBlockerCode;
  /** Plain-English reason, e.g. "Fixed fee line Essentials has no rate". */
  message: string;
  /** The contract_lines id (also the id charges carry as client_contract_line_id). */
  contractLineId: string;
  contractLineName: string;
}

export interface FixedChargeComputeResult {
  charges: IFixedPriceCharge[];
  explanations: ChargeExplanation[];
  /**
   * Present only when the line could not be priced. Any charges returned
   * alongside (e.g. the seats of a mixed line) are what WAS computable; the
   * invoice as a whole must still be refused.
   */
  blockers?: FixedChargeBlocker[];
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

export interface FixedPlanBaseRateInputs {
  clientContractLine: Pick<IClientContractLine, "custom_rate">;
  contractLineDetails: FixedChargeComputeInputs["contractLineDetails"];
  planServices: FixedPlanServiceRow[];
}

/**
 * Resolve the fixed plan's base rate in major units using the production
 * precedence order. Preview priceability checks call this same helper so they
 * cannot drift from the charge computation when a rate source changes.
 */
export function resolveFixedPlanLevelBaseRate({
  clientContractLine,
  contractLineDetails,
  planServices,
}: FixedPlanBaseRateInputs): number | null {
  if (contractLineDetails?.contract_line_type !== "Fixed") {
    return null;
  }

  let planLevelBaseRate: number | null = null;

  if (
    contractLineDetails.custom_rate !== undefined &&
    contractLineDetails.custom_rate !== null
  ) {
    const parsedContractRate =
      typeof contractLineDetails.custom_rate === "string"
        ? parseFloat(contractLineDetails.custom_rate)
        : Number(contractLineDetails.custom_rate);
    if (!Number.isNaN(parsedContractRate)) {
      // custom_rate is stored in cents; compute operates in major units here.
      planLevelBaseRate = parsedContractRate / 100;
    }
  }

  if (planLevelBaseRate === null && clientContractLine.custom_rate != null) {
    const parsedAssignmentRate =
      typeof clientContractLine.custom_rate === "string"
        ? parseFloat(clientContractLine.custom_rate)
        : Number(clientContractLine.custom_rate);
    if (!Number.isNaN(parsedAssignmentRate)) {
      planLevelBaseRate = parsedAssignmentRate / 100;
    }
  }

  if (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate)) {
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
      // service_base_rate is stored in cents.
      planLevelBaseRate = derivedBaseRate / 100;
    }
  }

  if (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate)) {
    const totalDefaultRateCents = planServices.reduce(
      (sum: number, service) => {
        const rate = preferredCatalogRate(service);
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

  return planLevelBaseRate !== null && !Number.isNaN(planLevelBaseRate)
    ? planLevelBaseRate
    : null;
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
  // LEVERAGE: pattern currency-minor-units — hard-coded /100 assumes a 2-digit currency; display/compute formatting should go through formatCurrencyFromMinorUnits (alga0002091 follow-up)
  }).format(cents / 100);
}

export type FixedFeeAllocationBasis = "stored_shares" | "quantity" | "even_split";

export interface FixedFeeAllocation {
  basis: FixedFeeAllocationBasis;
  /** Minor units per service, in input order; sums exactly to the fee. */
  amounts: number[];
  /** The weight each service carried under `basis`, in input order. */
  weights: number[];
  /** weight / Σ weights, in input order. */
  proportions: number[];
}

const nonNegativeFinite = (raw: unknown): number => {
  if (raw === null || raw === undefined) return 0;
  const parsed = typeof raw === "string" ? parseFloat(raw) : Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

/**
 * Split `totalCents` across weighted members so the parts sum EXACTLY to the
 * total: floor each exact share, then hand the leftover cents to the largest
 * fractional remainders (ties broken by service_id so the split never depends
 * on row order). `totalCents` is in the contract/invoice currency's minor
 * units; nothing here knows or assumes a currency.
 */
function allocateCentsByWeights(
  totalCents: number,
  members: Array<{ key: string; weight: number }>,
): { amounts: number[]; proportions: number[] } {
  const weightSum = members.reduce((sum, member) => sum + member.weight, 0);
  const exact = members.map((member) => (totalCents * member.weight) / weightSum);
  const amounts = exact.map((value) => Math.floor(value));
  let remainder = totalCents - amounts.reduce((sum, value) => sum + value, 0);
  const order = members
    .map((member, index) => ({ index, key: member.key, fraction: exact[index] - amounts[index] }))
    .sort(
      (a, b) =>
        b.fraction - a.fraction ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0) ||
        a.index - b.index,
    );
  for (let cursor = 0; remainder > 0 && order.length > 0; cursor += 1) {
    amounts[order[cursor % order.length].index] += 1;
    remainder -= 1;
  }
  return {
    amounts,
    proportions: members.map((member) => member.weight / weightSum),
  };
}

// LEVERAGE: pattern fixed-fee-allocation — "split one fixed fee across member
// services by a weight, with cent remainder handling" now exists in three
// places: the FMV allocation in computeFixedCharges below (no remainder
// handling), this helper, and the wizard's quantity share in
// contractWizardActions (last member takes the remainder). A single
// allocation layer should own weight → exact cents.
/**
 * Allocation for a fixed fee whose members carry no catalog price (FMV total
 * of 0), so the fee cannot be apportioned by fair market value. The full fee
 * is always billed. Weight chain:
 *  1. stored per-service shares (contract_line_service_fixed_config.base_rate,
 *     already the member's share of the line total — never × quantity) when
 *     they sum to more than 0;
 *  2. otherwise service quantity;
 *  3. otherwise an even split.
 */
export function allocateFixedFeeWithoutCatalogPrice(
  totalCents: number,
  services: Array<{
    service_id: string;
    service_base_rate?: number | string | null;
    quantity: number;
  }>,
): FixedFeeAllocation {
  const shareWeights = services.map((service) => nonNegativeFinite(service.service_base_rate));
  const quantityWeights = services.map((service) => nonNegativeFinite(service.quantity));
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

  let basis: FixedFeeAllocationBasis;
  let weights: number[];
  if (sum(shareWeights) > 0) {
    basis = "stored_shares";
    weights = shareWeights;
  } else if (sum(quantityWeights) > 0) {
    basis = "quantity";
    weights = quantityWeights;
  } else {
    basis = "even_split";
    weights = services.map(() => 1);
  }

  const { amounts, proportions } = allocateCentsByWeights(
    totalCents,
    services.map((service, index) => ({ key: service.service_id, weight: weights[index] })),
  );
  return { basis, amounts, weights, proportions };
}

function allocationBasisLabel(basis: FixedFeeAllocationBasis): string {
  switch (basis) {
    case "stored_shares":
      return "Stored per-service shares";
    case "quantity":
      return "Service quantity";
    case "even_split":
      return "Even split";
  }
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
    hasProductMembers = false,
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
  const blockers: FixedChargeBlocker[] = [];

  const isFixedFeePlan = contractLineDetails?.contract_line_type === "Fixed";
  const lineBlocker = (
    code: FixedChargeBlockerCode,
    describe: (contractLineName: string) => string,
  ): FixedChargeBlocker => {
    const contractLineName =
      clientContractLine.contract_line_name ||
      clientContractLine.contract_line_id ||
      clientContractLine.client_contract_line_id;
    return {
      code,
      message: describe(contractLineName),
      contractLineId:
        clientContractLine.contract_line_id ??
        clientContractLine.client_contract_line_id,
      contractLineName,
    };
  };
  const unresolvedRateBlocker = (): FixedChargeBlocker =>
    lineBlocker(
      FIXED_LINE_RATE_UNRESOLVED,
      (name) => `Fixed fee line ${name} has no rate`,
    );
  const noServicesBlocker = (): FixedChargeBlocker =>
    lineBlocker(
      FIXED_LINE_NO_SERVICES,
      (name) =>
        `Fixed fee line ${name} has a rate but no service to bill it on`,
    );

  // --- Plan-level fixed config (base rate and proration) ---
  const planLevelBaseRate = resolveFixedPlanLevelBaseRate({
    clientContractLine,
    contractLineDetails,
    planServices,
  });
  let planLevelEnableProration = false;

  if (isFixedFeePlan && contractLineDetails) {
    if (
      contractLineDetails.enable_proration !== undefined &&
      contractLineDetails.enable_proration !== null
    ) {
      planLevelEnableProration = Boolean(contractLineDetails.enable_proration);
    }
    fixedProrationEnabled = planLevelEnableProration;
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

  // A line with explicit unit-priced (seat) members prices those members from
  // their own unit rates, so a missing plan-level rate only blocks lines that
  // have nothing else to price with. Mixed lines are checked against their
  // bundle members below.
  const billsThroughProductFamily = planServices.length === 0 && hasProductMembers;
  if (
    isFixedFeePlan &&
    (planLevelBaseRate === null || Number.isNaN(planLevelBaseRate)) &&
    !hasUnitPricedFixedMembers(planServices)
  ) {
    return {
      charges: [],
      explanations: [],
      advanceGuard: null,
      ...(billsThroughProductFamily
        ? {}
        : { blockers: [unresolvedRateBlocker()] }),
    };
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

  // --- Explicit unit-priced Fixed members ("recurring seats/units") ---
  // Pricing basis is per service: only members that explicitly carry
  // pricing_basis = 'unit' bill quantity × unit rate. The bundle plan-level
  // base rate (line custom_rate / service_base_rate FMV derivation) has NO
  // precedence for them, and quantity zero is an explicit zero — never a
  // fallback to 1. NULL/'bundle' siblings on the same line keep the
  // fixed-bundle semantics below; opting one member into seats never
  // reinterprets the others.
  const unitServices = planServices.filter((service) => isUnitPricedFixedService(service));
  const bundleServices = planServices.filter((service) => !isUnitPricedFixedService(service));
  let heldUnitCharges: IFixedPriceCharge[] | null = null;

  if (isFixedFeePlan && unitServices.length > 0) {
    const unitCharges: IFixedPriceCharge[] = [];
    const unitExplanations: ChargeExplanation[] = [];

    for (const service of unitServices) {
      const rawQuantity =
        service.configuration_quantity ??
        service.service_quantity ??
        service.quantity;
      const quantity = rawQuantity == null ? 0 : Number(rawQuantity);
      if (!Number.isFinite(quantity) || quantity < 0) {
        console.error(
          `[BillingEngine] Unit-priced service ${service.service_id} on contract line ${clientContractLine.contract_line_id} has an invalid quantity; skipping seat charge.`,
        );
        continue;
      }
      if (quantity === 0) {
        // Explicit zero: no seats to bill. Never 1.
        continue;
      }

      const rawUnitRate =
        service.service_base_rate ??
        (service.configuration_custom_rate != null
          ? Number(service.configuration_custom_rate)
          : undefined) ??
        service.currency_rate ??
        service.default_rate;
      const unitRate = rawUnitRate == null ? null : Number(rawUnitRate);
      if (
        unitRate === null ||
        !Number.isFinite(unitRate) ||
        unitRate < 0
      ) {
        console.error(
          `[BillingEngine] Unit-priced service ${service.service_id} on contract line ${clientContractLine.contract_line_id} has no valid unit rate; skipping seat charge.`,
        );
        continue;
      }
      const rate = Math.ceil(unitRate);
      const total = Math.ceil(quantity * rate);

      const { taxRegion: serviceTaxRegion, isTaxable } =
        taxPorts.getTaxInfoFromService(service);
      const effectiveTaxRegion =
        serviceTaxRegion ??
        taxPorts.getLocationTaxRegionCode(clientContractLine.location_id) ??
        taxPorts.getClientDefaultTaxRegionCode(client.client_id) ??
        undefined;

      let taxAmount = 0;
      let taxRate = 0;
      if (
        !taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) &&
        isTaxable &&
        effectiveTaxRegion
      ) {
        const taxResult = taxPorts.calculateTax(
          client.client_id,
          total,
          servicePeriodEnd,
          effectiveTaxRegion,
          true,
          currencyCode,
          resolvedProfile?.billingProfileId ?? null,
        );
        taxRate = taxResult.taxRate;
        taxAmount = taxResult.taxAmount;
      }

      const unitCharge: IFixedPriceCharge = {
        serviceId: service.service_id,
        serviceName: service.service_name,
        quantity,
        rate,
        total,
        type: "fixed",
        client_contract_line_id: clientContractLine.client_contract_line_id,
        client_contract_id: clientContractLine.client_contract_id || undefined,
        contract_name: clientContractLine.contract_name || undefined,
        location_id: clientContractLine.location_id ?? null,
        billing_profile_id: resolvedProfile?.billingProfileId ?? null,
        billing_profile_source: resolvedProfile?.source ?? null,
        tax_amount: taxAmount,
        tax_rate: taxRate,
        tax_region: effectiveTaxRegion,
        is_taxable: isTaxable,
        config_id: service.config_id,
        base_rate: rate,
        servicePeriodStart,
        servicePeriodEnd,
        ...(service.effective_pricing
          ? {
              recurringPricingSource: {
                revisionId: service.effective_pricing.revisionId,
                version: service.effective_pricing.version,
                pricePolicy: service.effective_pricing.pricePolicy,
                unitRateCents: rate,
                effectivePeriodStart:
                  service.effective_pricing.effectivePeriodStart,
                catalogPriceId:
                  service.effective_pricing.pricePolicy === 'catalog'
                    ? service.effective_pricing.catalogPriceId ?? null
                    : null,
                catalogEffectiveDate:
                  service.effective_pricing.pricePolicy === 'catalog'
                    ? service.effective_pricing.catalogEffectiveDate ?? null
                    : null,
              },
            }
          : {}),
      };
      unitCharges.push(unitCharge);

      unitExplanations.push({
        chargeKey: fixedChargeKey(unitCharge),
        serviceName: service.service_name,
        chargeType: "fixed",
        inputs: [
          {
            label: "Unit rate",
            value: formatCents(rate, currencyCode),
          },
          { label: "Quantity", value: String(quantity) },
        ],
        steps: [
          `${String(quantity)} × ${formatCents(rate, currencyCode)} = ${formatCents(total, currencyCode)}`,
        ],
        note:
          "Recurring seats/units: quantity × unit rate. The fixed bundle total does not apply to this line.",
        markers: [],
      });
    }

    explanations.push(...unitExplanations);
    if (bundleServices.length === 0) {
      // Pure seats line: the unit charges are the whole line.
      generatedCharges = unitCharges;
    } else {
      // Mixed line: hold the seat charges and let the bundle allocation run
      // over the remaining (bundle/legacy) members only.
      heldUnitCharges = unitCharges;
    }
  }

  if (planServices.length === 0) {
    if (!isFixedFeePlan || planLevelBaseRateCents === null) {
      return { charges: [], explanations: [], advanceGuard: null };
    }

    const baseRateInCents = hasCustomRateOverride
      ? Math.round(Number(effectiveCustomRate))
      : planLevelBaseRateCents;

    if (!fallbackService?.service_id || !fallbackService?.config_id) {
      // A positive rate with nothing to bill it on must not vanish silently
      // (Estimated monthly still counts custom_rate). A rate of 0 bills
      // nothing by design and keeps the quiet return.
      if (
        !billsThroughProductFamily &&
        Number.isFinite(baseRateInCents) &&
        baseRateInCents > 0
      ) {
        return {
          charges: [],
          explanations: [],
          advanceGuard: null,
          blockers: [noServicesBlocker()],
        };
      }
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
    // Exemption is per billing profile (F131), not per client — one invoice
    // can carry both exempt and non-exempt lines.
    if (
      !taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) &&
      fallbackIsTaxable &&
      fallbackTaxRegion
    ) {
      const taxResult = taxPorts.calculateTax(
        client.client_id,
        baseRateInCents,
        servicePeriodEnd,
        fallbackTaxRegion,
        true,
        currencyCode,
        resolvedProfile?.billingProfileId ?? null,
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
    // Consolidated fixed fee, internally allocated across the BUNDLE members
    // by FMV. Unit-priced members already billed as seats above and are
    // excluded here — from the fee derivation and from the allocation — so a
    // mixed line never double-bills a seat as a bundle allocation.
    const normalizedBundleServices = normalizedPlanServices.filter(
      (service) => !isUnitPricedFixedService(service),
    );
    // With unit members present and no explicit line rate, the bundle fee is
    // derived from the bundle members alone (a seat's unit rate is per seat,
    // not part of the bundle pool).
    const bundleLevelBaseRate =
      unitServices.length > 0
        ? resolveFixedPlanLevelBaseRate({
            clientContractLine,
            contractLineDetails,
            planServices: bundleServices,
          })
        : planLevelBaseRate;
    if (bundleLevelBaseRate === null || Number.isNaN(bundleLevelBaseRate)) {
      // The bundle members cannot be priced. Never drop them silently: report
      // the line as blocked. Seats that ARE priceable are still returned so
      // callers that ignore blockers (simulation) keep their behavior.
      blockers.push(unresolvedRateBlocker());
      if (heldUnitCharges) {
        generatedCharges = heldUnitCharges;
        heldUnitCharges = null;
      } else {
        return {
          charges: [],
          explanations: [],
          advanceGuard: null,
          blockers,
        };
      }
    }
    const baseRateInCents = hasCustomRateOverride
      ? Math.round(Number(effectiveCustomRate))
      : Math.round((bundleLevelBaseRate ?? 0) * 100);

    if (!Number.isFinite(baseRateInCents) && !generatedCharges) {
      // A custom rate that is not a number is an unresolved rate, not zero.
      blockers.push(unresolvedRateBlocker());
      if (heldUnitCharges) {
        generatedCharges = heldUnitCharges;
        heldUnitCharges = null;
      } else {
        return {
          charges: [],
          explanations: [],
          advanceGuard: null,
          blockers,
        };
      }
    }

    const totalFMVCents = normalizedBundleServices.reduce((sum, service) => {
      const serviceFMV = preferredCatalogRate(service) * service.quantity;
      return sum + serviceFMV;
    }, 0);

    // Zero FMV cannot be apportioned by fair market value. Negative FMV is
    // valid (credit services). When the line still carries a positive fee, that
    // fee is billed IN FULL, allocated by stored shares → quantity → even split
    // (see allocateFixedFeeWithoutCatalogPrice). Only a fee of 0 has nothing to
    // bill; unresolved rates were rejected above.
    let zeroFmvAllocation: FixedFeeAllocation | null = null;
    if (!generatedCharges && totalFMVCents === 0) {
      const effectiveFeeCents = planLevelEnableProration
        ? Math.round(baseRateInCents * coverageRatio)
        : baseRateInCents;
      if (baseRateInCents > 0 && normalizedBundleServices.length > 0) {
        zeroFmvAllocation = allocateFixedFeeWithoutCatalogPrice(
          effectiveFeeCents,
          normalizedBundleServices,
        );
      } else {
        console.log(
          `Total FMV (cents) for services in plan ${clientContractLine.contract_line_id} is zero and the plan rate is ${baseRateInCents}; nothing to allocate`,
        );
        if (heldUnitCharges) {
          generatedCharges = heldUnitCharges;
          heldUnitCharges = null;
        } else {
          return { charges: [], explanations: [], advanceGuard: null };
        }
      }
    }

    // When a guard above already resolved the charges (seats only), the
    // allocation below runs over nothing.
    const bundleAllocationNeeded = !generatedCharges;
    // LEVERAGE: pattern fixed-fee-allocation — FMV-weighted split; rounds each
    // member independently (no remainder handling), unlike the zero-FMV path.
    const serviceAllocations = (bundleAllocationNeeded ? normalizedBundleServices : []).map((service, serviceIndex) => {
      // FMV is based on the service's catalog rate (cents), not plan overrides.
      const rateForFMV = preferredCatalogRate(service);
      const serviceFMVCents = Math.round(rateForFMV * service.quantity);

      const proportion = zeroFmvAllocation
        ? zeroFmvAllocation.proportions[serviceIndex]
        : totalFMVCents !== 0
          ? serviceFMVCents / totalFMVCents
          : 0;

      let prorationFactor = 1.0;
      let effectiveBaseRateInCents = baseRateInCents;
      if (planLevelEnableProration) {
        prorationFactor = coverageRatio;
        effectiveBaseRateInCents = Math.round(
          effectiveBaseRateInCents * prorationFactor,
        );
      }

      const allocatedAmount = zeroFmvAllocation
        ? zeroFmvAllocation.amounts[serviceIndex]
        : Math.round(effectiveBaseRateInCents * proportion);

      const { taxRegion: serviceTaxRegion, isTaxable } =
        taxPorts.getTaxInfoFromService(service);

      let taxAmount = 0;
      let taxRate = 0;
      if (!taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) && isTaxable) {
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
            resolvedProfile?.billingProfileId ?? null,
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

    for (const [allocationIndex, allocation] of serviceAllocations.entries()) {
      const planService = normalizedBundleServices.find(
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
        zeroFmvAllocation
          ? {
              label: "Allocation basis",
              value: allocationBasisLabel(zeroFmvAllocation.basis),
            }
          : {
              label: "FMV proportion",
              value: `×${allocation.proportion.toFixed(4)}`,
            },
      ];
      if (zeroFmvAllocation) {
        const weight = zeroFmvAllocation.weights[allocationIndex];
        explanationInputs.push(
          {
            label: "Allocation weight",
            value:
              zeroFmvAllocation.basis === "stored_shares"
                ? formatCents(weight, currencyCode)
                : String(weight),
          },
          {
            label: "Allocation share",
            value: `×${allocation.proportion.toFixed(4)}`,
          },
        );
      }
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
      if (zeroFmvAllocation) {
        markers.push("fixed_fee_allocation_fallback");
      } else if (normalizedBundleServices.length > 1) {
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
        note: zeroFmvAllocation
          ? `The services have no catalog price, so the plan's full fixed fee is allocated by ${allocationBasisLabel(zeroFmvAllocation.basis).toLowerCase()}; cent remainders go to the largest fractions so the parts sum exactly to the fee.`
          : normalizedBundleServices.length > 1
            ? "The plan's fixed fee is allocated across its services in proportion to their fair market value."
            : planLevelEnableProration && allocation.prorationFactor !== 1
              ? "Prorated — the service period covers part of the billing period."
              : undefined,
        markers,
      });
    }

    if (bundleAllocationNeeded) {
      generatedCharges = detailedCharges;
      generatedChargeAmountsUseCoverage = planLevelEnableProration;
    }
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
            : preferredCatalogRate(service);
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
        if (!taxPorts.isTaxExemptForProfile(resolvedProfile?.billingProfileId) && charge.is_taxable) {
          const effectiveTaxRegion = charge.tax_region ?? "";
          if (effectiveTaxRegion) {
            const taxResult = taxPorts.calculateTax(
              client.client_id,
              charge.total,
              servicePeriodEnd,
              effectiveTaxRegion,
              true,
              currencyCode,
              resolvedProfile?.billingProfileId ?? null,
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
    return {
      charges: [],
      explanations: [],
      advanceGuard: null,
      ...(blockers.length > 0 ? { blockers } : {}),
    };
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

  if (heldUnitCharges) {
    chargesAfterSettlement.push(...((fixedProrationEnabled || requiresAdvanceTerminationSettlement)
      ? applyFixedChargeCoverageSettlement(heldUnitCharges, coverageRatio, requiresAdvanceTerminationSettlement ? "unused_credit_net" : "coverage_ratio")
      : heldUnitCharges));
  }

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
    ...(blockers.length > 0 ? { blockers } : {}),
  };
}
