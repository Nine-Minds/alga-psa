/**
 * Pure evaluation of one-time charges, discounts and adjustments on an
 * editable contract invoice.
 *
 * This module is deliberately side-effect free: persistence, locking and tax
 * distribution live in the invoice services. Generation and draft
 * recalculation both feed the same persisted charge rows through here so the
 * customer-facing totals and the stored rows cannot drift.
 *
 * All monetary values are integer minor units (cents) unless a name says
 * otherwise. Quantities and rates may stay fractional during calculation; only
 * resolved amounts are rounded, once.
 */

import { Temporal } from '@js-temporal/polyfill';

export type AdjustmentSourceKind = 'discount' | 'contract_change';
export type DiscountScope = 'invoice' | 'contract' | 'line' | 'service' | 'item';

/** The subset of an `invoice_charges` row the evaluator needs. */
export interface InvoiceAdjustmentCharge {
  item_id: string;
  service_id?: string | null;
  client_contract_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  net_amount: number;
  is_discount?: boolean;
  is_manual?: boolean;
  is_taxable?: boolean;
  adjustment_source_kind?: AdjustmentSourceKind | null;
  contract_line_ids?: string[];
  /** Half-open service coverage periods represented by this charge. */
  service_periods?: Array<{ start: string; end: string }>;
  /** Exact persisted detail amounts; never apportion a parent by period count. */
  period_allocations?: Array<{ net_amount: number; service_periods: Array<{ start: string; end: string }> }>;
}

export interface AutomaticDiscountPolicy {
  discount_id: string;
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  /**
   * Percentage policies are stored as fractions by the billing engine
   * (0.10 = 10%). Set `valueUnit: 'percent'` when the caller already holds a
   * normalized percentage. Fixed policies are always minor units.
   */
  value: number;
  valueUnit?: 'fraction' | 'percent';
  scope: DiscountScope;
  applies_to_service_id?: string | null;
  applies_to_item_id?: string | null;
  client_contract_id?: string | null;
  contract_line_id?: string | null;
  priority?: number | null;
  /** Half-open period in which the configured discount is effective. */
  effective_period?: { start: string; end: string } | null;
}

export interface DiscountAllocation {
  discount_id: string;
  item_id: string;
  amount: number;
}

export interface AutomaticDiscountResult {
  discount_id: string;
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  /** Normalized percentage (10 for 10%) or fixed minor units. */
  value: number;
  scope: DiscountScope;
  /** Sum of positive eligible bases the discount resolved against. */
  base_amount: number;
  /** Rounded integer minor units actually applied (never negative). */
  amount: number;
  allocations: DiscountAllocation[];
}

export interface ContractInvoiceAdjustmentInputs {
  charges: InvoiceAdjustmentCharge[];
  automaticDiscounts: AutomaticDiscountPolicy[];
}

export interface ContractInvoiceAdjustmentResult {
  /** Positive eligible charge rows, in input order. */
  eligibleCharges: InvoiceAdjustmentCharge[];
  /** Automatic discounts in evaluation order with their allocations. */
  discounts: AutomaticDiscountResult[];
  /** Total positive gross (before any discount). */
  grossAmount: number;
  /** Total automatic discount (positive magnitude). */
  automaticDiscountAmount: number;
  /** Gross minus automatic discounts. */
  netAmount: number;
}

export interface PartialPeriodInput {
  units: number;
  unitPrice: number;
  coveredDays: number;
  fullPeriodDays: number;
}

function assertFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a finite number`);
  }
}

function toIntegerMinorUnits(value: number): number {
  return Math.round(value);
}

/**
 * Resolves a partial-period one-time line: units × unit price × covered days /
 * full period days, rounded once to integer minor units. The caller persists
 * the inputs alongside the resolved amount so "3 × $100 × 15/30" stays
 * intelligible.
 */
export function computePartialPeriodAmount(input: PartialPeriodInput): number {
  const { units, unitPrice, coveredDays, fullPeriodDays } = input;
  assertFinite('units', units);
  assertFinite('unitPrice', unitPrice);
  assertFinite('coveredDays', coveredDays);
  assertFinite('fullPeriodDays', fullPeriodDays);
  if (units < 0) throw new Error('units must not be negative');
  if (fullPeriodDays <= 0) throw new Error('fullPeriodDays must be greater than zero');
  if (coveredDays < 0) throw new Error('coveredDays must not be negative');

  return toIntegerMinorUnits((units * unitPrice * coveredDays) / fullPeriodDays);
}

export function resolveSourceDerivedPartialPeriod(input: {
  units: number;
  unitPrice: number;
  effectiveDate: string;
  servicePeriodStart: string;
  servicePeriodEnd: string;
  direction: 'increase' | 'decrease';
}): { quantity: number; unitPrice: number; amount: number; coveredDays: number; fullPeriodDays: number } {
  const start = Temporal.PlainDate.from(input.servicePeriodStart.slice(0, 10));
  const end = Temporal.PlainDate.from(input.servicePeriodEnd.slice(0, 10));
  const effective = Temporal.PlainDate.from(input.effectiveDate);
  if (Temporal.PlainDate.compare(end, start) <= 0) throw new Error('The source service period is invalid.');
  if (Temporal.PlainDate.compare(effective, start) < 0 || Temporal.PlainDate.compare(effective, end) >= 0) {
    throw new Error('Effective date must fall inside the selected service period.');
  }
  if (!Number.isFinite(input.units) || input.units <= 0) throw new Error('Unit change must be greater than zero.');
  if (!Number.isFinite(input.unitPrice) || input.unitPrice < 0) throw new Error('The source rate must be a non-negative amount.');
  const fullPeriodDays = start.until(end, { largestUnit: 'days' }).days;
  const coveredDays = effective.until(end, { largestUnit: 'days' }).days;
  // invoice_charges stores unit_price in integer minor units and quantity at
  // 0.01 precision. Round the magnitude of the per-unit rate first, apply the
  // sign, then use the same JavaScript Math.round(signed product) rule as the
  // invoice totals writer. In particular, negative half cents round toward
  // positive infinity, consistently in preview, save, reload, and export.
  const roundedUnitRate = Math.round(input.unitPrice * coveredDays / fullPeriodDays);
  const sign = input.direction === 'decrease' ? -1 : 1;
  const signedRate = sign * roundedUnitRate;
  return {
    quantity: input.units,
    unitPrice: signedRate,
    amount: Math.round(input.units * signedRate),
    coveredDays,
    fullPeriodDays,
  };
}

/** Half-open overlap check for a manual calculator window and companion true-up. */
export function hasOverlappingContractChangeAdjustment(input: {
  contractLineId: string;
  effectiveDate: string;
  periodEnd: string;
  adjustments: Array<{
    adjustment_source_kind?: string | null;
    contract_line_id?: string | null;
    adjustment_period_start?: string | null;
    adjustment_period_end?: string | null;
  }>;
}): boolean {
  return input.adjustments.some((row) => {
    if (row.adjustment_source_kind !== 'contract_change'
      || row.contract_line_id !== input.contractLineId
      || !row.adjustment_period_start || !row.adjustment_period_end) return false;
    const start = row.adjustment_period_start.slice(0, 10);
    const end = row.adjustment_period_end.slice(0, 10);
    return start < input.periodEnd && input.effectiveDate < end;
  });
}

export function normalizeDiscountValue(policy: Pick<AutomaticDiscountPolicy, 'discount_type' | 'value' | 'valueUnit'>): number {
  if (policy.discount_type === 'fixed') {
    return Math.abs(toIntegerMinorUnits(policy.value));
  }
  const percent = policy.valueUnit === 'percent' ? policy.value : policy.value * 100;
  return percent;
}

/**
 * Converts a persisted `discounts.value` into the evaluator's policy units.
 *
 * `discounts.value` is `decimal(10,2)`, and its meaning depends on the type:
 * a **fixed** discount stores a decimal currency amount (`50.00` = $50.00) while
 * a **percentage** stores a fraction (`0.10` = 10%). The evaluator works in
 * integer minor units, so a fixed value is converted exactly once here; a
 * percentage keeps its stored fraction and is normalized during evaluation.
 * Non-finite and null inputs resolve to zero rather than propagating `NaN`.
 */
export function storedDiscountValueToPolicyValue(
  discount_type: 'percentage' | 'fixed',
  value: number | string | null | undefined,
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return discount_type === 'fixed' ? Math.round(numeric * 100) : numeric;
}

function isEligibleCharge(charge: InvoiceAdjustmentCharge): boolean {
  // Discount rows, credits and negative true-up reversals are never a positive
  // discount base; including them would grant the discount twice.
  return !charge.is_discount && Number(charge.net_amount) > 0;
}

interface EvaluationCharge extends InvoiceAdjustmentCharge {
  parent_item_id?: string;
}

function chargesInScope(
  policy: AutomaticDiscountPolicy,
  eligible: EvaluationCharge[],
): EvaluationCharge[] {
  switch (policy.scope) {
    case 'invoice':
      return eligible.filter(
        (charge) => !policy.client_contract_id
          || charge.client_contract_id === policy.client_contract_id
          // An explicitly invoice-scoped discount attached to one contract
          // assignment also covers eligible unattributed manual additions.
          // Charges attributed to another assignment remain isolated.
          || charge.client_contract_id == null,
      );
    case 'contract':
      return eligible.filter(
        (charge) => Boolean(policy.client_contract_id)
          && charge.client_contract_id === policy.client_contract_id
          && (!policy.applies_to_service_id || charge.service_id === policy.applies_to_service_id),
      );
    case 'line':
      return eligible.filter(
        (charge) => typeof policy.contract_line_id === 'string'
          && charge.contract_line_ids?.includes(policy.contract_line_id)
          && (!policy.client_contract_id || charge.client_contract_id === policy.client_contract_id),
      );
    case 'service':
      return eligible.filter(
        (charge) => Boolean(policy.applies_to_service_id)
          && charge.service_id === policy.applies_to_service_id
          && (!policy.client_contract_id || charge.client_contract_id === policy.client_contract_id),
      );
    case 'item':
      return eligible.filter(
        (charge) => Boolean(policy.applies_to_item_id) && (charge.parent_item_id ?? charge.item_id) === policy.applies_to_item_id,
      );
    default:
      return [];
  }
}

function chargeIsEligibleForPeriod(policy: AutomaticDiscountPolicy, charge: InvoiceAdjustmentCharge): boolean {
  const effectivePeriod = policy.effective_period;
  if (!effectivePeriod) return true;
  return Boolean(charge.service_periods?.some((period) =>
    period.start < effectivePeriod.end && period.end > effectivePeriod.start,
  ));
}

/**
 * Distributes `total` integer minor units across weighted bases using the
 * largest-remainder method. Ties break on the charge key so the result is
 * deterministic for a given charge set.
 */
export function allocateByLargestRemainder(
  total: number,
  bases: Array<{ key: string; weight: number }>,
): Map<string, number> {
  const allocations = new Map<string, number>();
  for (const base of bases) {
    allocations.set(base.key, 0);
  }

  const target = Math.max(0, toIntegerMinorUnits(total));
  if (target === 0) {
    return allocations;
  }

  const weightTotal = bases.reduce((sum, base) => sum + Math.max(0, base.weight), 0);
  if (weightTotal <= 0) {
    return allocations;
  }

  const remainders: Array<{ key: string; remainder: number; order: number }> = [];
  let allocated = 0;
  bases.forEach((base, order) => {
    const weight = Math.max(0, base.weight);
    const exact = (target * weight) / weightTotal;
    const floor = Math.floor(exact);
    allocations.set(base.key, floor);
    allocated += floor;
    remainders.push({ key: base.key, remainder: exact - floor, order });
  });

  let leftover = target - allocated;
  remainders.sort((a, b) => {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    if (a.key !== b.key) return a.key < b.key ? -1 : 1;
    return a.order - b.order;
  });
  for (const entry of remainders) {
    if (leftover <= 0) break;
    allocations.set(entry.key, (allocations.get(entry.key) ?? 0) + 1);
    leftover -= 1;
  }

  return allocations;
}

function evaluateDiscount(
  policy: AutomaticDiscountPolicy,
  eligible: EvaluationCharge[],
  remainingByItem: Map<string, number>,
): AutomaticDiscountResult | null {
  const scoped = chargesInScope(policy, eligible).filter((charge) => chargeIsEligibleForPeriod(policy, charge));
  if (scoped.length === 0) {
    return null;
  }

  const baseAmount = scoped.reduce((sum, charge) => sum + Number(charge.net_amount), 0);
  const normalizedValue = normalizeDiscountValue(policy);

  const nominal = policy.discount_type === 'percentage'
    ? toIntegerMinorUnits((baseAmount * normalizedValue) / 100)
    : normalizedValue;

  if (nominal <= 0) {
    return null;
  }

  const weightedBases = scoped
    .map((charge) => ({ key: charge.item_id, weight: remainingByItem.get(charge.item_id) ?? 0 }))
    .filter((base) => base.weight > 0);
  const remainingCapacity = weightedBases.reduce((sum, base) => sum + base.weight, 0);
  if (remainingCapacity <= 0) {
    return null;
  }

  const resolved = Math.min(nominal, remainingCapacity);
  const allocationMap = allocateByLargestRemainder(resolved, weightedBases);
  const allocations: DiscountAllocation[] = [];
  let applied = 0;
  for (const charge of scoped) {
    const amount = allocationMap.get(charge.item_id) ?? 0;
    if (amount <= 0) continue;
    allocations.push({ discount_id: policy.discount_id, item_id: charge.item_id, amount });
    remainingByItem.set(charge.item_id, Math.max(0, (remainingByItem.get(charge.item_id) ?? 0) - amount));
    applied += amount;
  }

  if (applied <= 0) {
    return null;
  }

  return {
    discount_id: policy.discount_id,
    discount_name: policy.discount_name,
    discount_type: policy.discount_type,
    value: normalizedValue,
    scope: policy.scope,
    base_amount: baseAmount,
    amount: applied,
    allocations,
  };
}

/**
 * Evaluates configured automatic discounts against positive eligible charges.
 *
 * Ordering is persisted priority (ascending, nulls last) then stable
 * `discount_id`, so the same inputs always produce the same allocation.
 * Percentage discounts are computed against their original eligible base (no
 * implicit compounding) and then capped against the remaining eligible value;
 * commercial discounts can never exceed the value they discount, so
 * `netAmount` never goes negative from discounts alone.
 */
export function evaluateContractInvoiceAdjustments(
  inputs: ContractInvoiceAdjustmentInputs,
): ContractInvoiceAdjustmentResult {
  const eligibleCharges = inputs.charges.filter(isEligibleCharge);
  const grossAmount = eligibleCharges.reduce((sum, charge) => sum + Number(charge.net_amount), 0);

  // Evaluate exact amount-bearing portions independently so one expired term
  // cannot consume a later period's amount or discount capacity. Output still
  // uses canonical parent charge IDs, not these evaluation-only keys.
  const evaluationCharges: EvaluationCharge[] = eligibleCharges.flatMap((charge) => {
    if (!charge.period_allocations?.length) return [charge];
    const portions = charge.period_allocations;
    if (portions.some((part) => !Number.isSafeInteger(part.net_amount) || part.net_amount < 0)
      || portions.reduce((sum, part) => sum + part.net_amount, 0) !== charge.net_amount) {
      throw new Error(`Service-period allocations do not match invoice charge ${charge.item_id}`);
    }
    const grouped = new Map<string, { net_amount: number; service_periods: Array<{ start: string; end: string }> }>();
    for (const part of portions) {
      const periods = [...part.service_periods].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
      const key = JSON.stringify(periods);
      const group = grouped.get(key);
      if (group) group.net_amount += part.net_amount;
      else grouped.set(key, { net_amount: part.net_amount, service_periods: periods });
    }
    if (grouped.size === 1) return [{ ...charge, service_periods: [...grouped.values()][0].service_periods }];
    return [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([, part], index) => ({
      ...charge,
      item_id: JSON.stringify([charge.item_id, index]),
      parent_item_id: charge.item_id,
      net_amount: part.net_amount,
      service_periods: part.service_periods,
    })).filter(isEligibleCharge);
  });
  const parentIds = new Map(evaluationCharges.map((charge) => [charge.item_id, charge.parent_item_id ?? charge.item_id]));
  const remainingByItem = new Map<string, number>();
  for (const charge of evaluationCharges) {
    remainingByItem.set(charge.item_id, Number(charge.net_amount));
  }

  const orderedPolicies = [...inputs.automaticDiscounts].sort((a, b) => {
    const aPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return a.discount_id < b.discount_id ? -1 : a.discount_id > b.discount_id ? 1 : 0;
  });

  const discounts: AutomaticDiscountResult[] = [];
  for (const policy of orderedPolicies) {
    if (policy.scope === 'item' && !policy.applies_to_item_id) continue;
    if (policy.scope === 'service' && !policy.applies_to_service_id) continue;
    if (policy.scope === 'contract' && !policy.client_contract_id) continue;
    const result = evaluateDiscount(policy, evaluationCharges, remainingByItem);
    if (result) {
      const allocationsByParent = new Map<string, number>();
      for (const allocation of result.allocations) {
        const parentId = parentIds.get(allocation.item_id)!;
        allocationsByParent.set(parentId, (allocationsByParent.get(parentId) ?? 0) + allocation.amount);
      }
      result.allocations = [...allocationsByParent].map(([item_id, amount]) => ({
        discount_id: result.discount_id, item_id, amount,
      }));
      discounts.push(result);
    }
  }

  const automaticDiscountAmount = discounts.reduce((sum, discount) => sum + discount.amount, 0);

  return {
    eligibleCharges,
    discounts,
    grossAmount,
    automaticDiscountAmount,
    netAmount: grossAmount - automaticDiscountAmount,
  };
}

/**
 * Flattens automatic discount results into one persisted discount line per
 * policy (matching the existing `invoice_charges` discount-row shape) while
 * retaining the per-charge allocation for provenance.
 */
export function toPersistedAutomaticDiscountLines(
  result: ContractInvoiceAdjustmentResult,
): Array<{
  discount_id: string;
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  value: number;
  scope: DiscountScope;
  base_amount: number;
  amount: number;
  allocations: DiscountAllocation[];
}> {
  return result.discounts.map((discount) => ({
    discount_id: discount.discount_id,
    discount_name: discount.discount_name,
    discount_type: discount.discount_type,
    value: discount.value,
    scope: discount.scope,
    base_amount: discount.base_amount,
    amount: discount.amount,
    allocations: discount.allocations,
  }));
}
