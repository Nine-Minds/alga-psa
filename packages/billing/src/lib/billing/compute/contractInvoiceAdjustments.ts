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

export type AdjustmentSourceKind = 'discount' | 'contract_change';
export type DiscountScope = 'invoice' | 'contract' | 'service' | 'item';

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
  priority?: number | null;
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

export function normalizeDiscountValue(policy: Pick<AutomaticDiscountPolicy, 'discount_type' | 'value' | 'valueUnit'>): number {
  if (policy.discount_type === 'fixed') {
    return Math.abs(toIntegerMinorUnits(policy.value));
  }
  const percent = policy.valueUnit === 'percent' ? policy.value : policy.value * 100;
  return percent;
}

function isEligibleCharge(charge: InvoiceAdjustmentCharge): boolean {
  // Discount rows, credits and negative true-up reversals are never a positive
  // discount base; including them would grant the discount twice.
  return !charge.is_discount && Number(charge.net_amount) > 0;
}

function chargesInScope(
  policy: AutomaticDiscountPolicy,
  eligible: InvoiceAdjustmentCharge[],
): InvoiceAdjustmentCharge[] {
  switch (policy.scope) {
    case 'invoice':
      return eligible;
    case 'contract':
      return eligible.filter(
        (charge) => Boolean(policy.client_contract_id) && charge.client_contract_id === policy.client_contract_id,
      );
    case 'service':
      return eligible.filter(
        (charge) => Boolean(policy.applies_to_service_id) && charge.service_id === policy.applies_to_service_id,
      );
    case 'item':
      return eligible.filter(
        (charge) => Boolean(policy.applies_to_item_id) && charge.item_id === policy.applies_to_item_id,
      );
    default:
      return [];
  }
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
  eligible: InvoiceAdjustmentCharge[],
  remainingByItem: Map<string, number>,
): AutomaticDiscountResult | null {
  const scoped = chargesInScope(policy, eligible);
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

  const remainingByItem = new Map<string, number>();
  for (const charge of eligibleCharges) {
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
    const result = evaluateDiscount(policy, eligibleCharges, remainingByItem);
    if (result) {
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
