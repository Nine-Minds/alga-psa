import type {
  ChargeExplanation,
  IAdjustment,
  IBillingCharge,
  IBillingPeriod,
  IBillingResult,
  IDiscount,
  ISO8601String,
} from "@alga-psa/types";

export interface DiscountComputeCandidate extends IDiscount {
  contract_line_id?: string | null;
  start_date: ISO8601String;
  /** Exclusive, matching production discount queries. */
  end_date?: ISO8601String | null;
}

export interface DiscountsAndAdjustmentsComputeInputs {
  billingResult: IBillingResult;
  billingPeriod: IBillingPeriod;
  discountCandidates: DiscountComputeCandidate[];
  adjustments: IAdjustment[];
}

export interface DiscountsAndAdjustmentsComputeResult {
  billingResult: IBillingResult;
  explanations: ChargeExplanation[];
}

interface EvaluationWindow {
  start: string;
  endInclusive: string;
}

function dateOnly(value: ISO8601String): string {
  return value.slice(0, 10);
}

export function buildDiscountEvaluationWindowsByContractLine(
  charges: IBillingCharge[],
): Map<string, EvaluationWindow[]> {
  const windowsByLine = new Map<string, EvaluationWindow[]>();
  for (const charge of charges) {
    if (
      !charge.client_contract_line_id ||
      !charge.servicePeriodStart ||
      !charge.servicePeriodEnd
    ) {
      continue;
    }
    const window = {
      start: dateOnly(charge.servicePeriodStart),
      endInclusive: dateOnly(charge.servicePeriodEnd),
    };
    const windows = windowsByLine.get(charge.client_contract_line_id) ?? [];
    if (
      !windows.some(
        (candidate) =>
          candidate.start === window.start &&
          candidate.endInclusive === window.endInclusive,
      )
    ) {
      windows.push(window);
      windowsByLine.set(charge.client_contract_line_id, windows);
    }
  }
  return windowsByLine;
}

export function filterApplicableDiscounts(
  candidates: DiscountComputeCandidate[],
  billingPeriod: IBillingPeriod,
  charges: IBillingCharge[],
): IDiscount[] {
  const windowsByLine = buildDiscountEvaluationWindowsByContractLine(charges);
  const invoiceWindow: EvaluationWindow = {
    start: dateOnly(billingPeriod.startDate),
    // Preserve current engine behavior: endDate participates as the inclusive
    // query/evaluation boundary even when the invoice window is half-open.
    endInclusive: dateOnly(billingPeriod.endDate),
  };
  const applicable = candidates.filter((discount) => {
    const lineWindows = discount.contract_line_id
      ? windowsByLine.get(discount.contract_line_id)
      : undefined;
    const windows = lineWindows?.length ? lineWindows : [invoiceWindow];
    const start = dateOnly(discount.start_date);
    const endExclusive = discount.end_date
      ? dateOnly(discount.end_date)
      : null;
    return windows.some(
      (window) =>
        start <= window.endInclusive &&
        (endExclusive == null || endExclusive > window.start),
    );
  });

  return Array.from(
    new Map(
      applicable.map((discount) => [
        discount.discount_id,
        {
          discount_id: discount.discount_id,
          discount_name: discount.discount_name,
          discount_type: discount.discount_type,
          value: discount.value,
          tenant: discount.tenant,
        } satisfies IDiscount,
      ]),
    ).values(),
  );
}

function formatCents(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode || "USD",
  }).format(cents / 100);
}

export function computeDiscountsAndAdjustments(
  inputs: DiscountsAndAdjustmentsComputeInputs,
): DiscountsAndAdjustmentsComputeResult {
  const { billingResult, billingPeriod, discountCandidates, adjustments } =
    inputs;
  const currencyCode = billingResult.currency_code || "USD";
  const applicableDiscounts = filterApplicableDiscounts(
    discountCandidates,
    billingPeriod,
    billingResult.charges,
  );
  let discountTotal = 0;
  const discounts = applicableDiscounts.map((discount) => {
    const amount =
      discount.discount_type === "percentage"
        ? billingResult.totalAmount * discount.value
        : discount.value;
    discountTotal += amount;
    return { ...discount, amount };
  });
  const adjustmentTotal = adjustments.reduce(
    (sum, adjustment) => sum + adjustment.amount,
    0,
  );
  const finalAmount =
    billingResult.totalAmount - discountTotal + adjustmentTotal;

  const explanations: ChargeExplanation[] = [
    ...discounts.map((discount) => ({
      chargeKey: `discount:${discount.discount_id}`,
      serviceName: discount.discount_name,
      chargeType: "discount",
      inputs: [
        {
          label: "Type",
          value:
            discount.discount_type === "percentage"
              ? `${discount.value * 100}%`
              : "Fixed",
        },
      ],
      steps: [
        discount.discount_type === "percentage"
          ? `${formatCents(billingResult.totalAmount, currencyCode)} × ${discount.value * 100}% = −${formatCents(discount.amount ?? 0, currencyCode)}`
          : `Fixed discount = −${formatCents(discount.amount ?? 0, currencyCode)}`,
      ],
      markers: [],
    })),
    ...adjustments.map((adjustment, index) => ({
      chargeKey: `adjustment:${index}`,
      serviceName: adjustment.description,
      chargeType: "adjustment",
      inputs: [{ label: "Amount", value: formatCents(adjustment.amount, currencyCode) }],
      steps: [`Adjustment = ${formatCents(adjustment.amount, currencyCode)}`],
      markers: [],
    })),
  ];

  return {
    billingResult: {
      ...billingResult,
      discounts,
      adjustments: [...adjustments],
      finalAmount,
    },
    explanations,
  };
}
