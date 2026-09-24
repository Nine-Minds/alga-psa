/**
 * Pure validation and value conversion for configured-discount authoring.
 *
 * Kept out of the `'use server'` action module so it can be unit-tested without
 * a database or auth context. The action module owns tenancy, permissions and
 * persistence; this module owns the shape rules.
 */
import { isValidDateOnly } from './dateOnly';

export { toDateOnly } from './dateOnly';

export type DiscountAuthoringScope = 'invoice' | 'contract' | 'service' | 'item';

export interface DiscountAuthoringInput {
  discount_name: string;
  discount_type: 'percentage' | 'fixed';
  /** Percentage in percent units (0, 100], or fixed decimal currency amount. */
  value: number;
  start_date: string;
  end_date?: string | null;
  contract_line_id: string;
  scope: DiscountAuthoringScope;
  scope_service_id?: string | null;
  applies_to_item_id?: string | null;
  priority?: number | null;
  is_active?: boolean;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function validateDiscountInput(input: DiscountAuthoringInput): string | null {
  if (!input || typeof input !== 'object') return 'A discount definition is required.';
  if (!input.discount_name || !input.discount_name.trim()) return 'Discount name is required.';
  if (input.discount_type !== 'percentage' && input.discount_type !== 'fixed') {
    return 'Discount type must be percentage or fixed.';
  }
  if (!Number.isFinite(input.value)) return 'Discount value must be a finite number.';
  if (input.discount_type === 'percentage' && (input.value <= 0 || input.value > 100)) {
    return 'Percentage discounts must be greater than 0 and at most 100.';
  }
  if (input.discount_type === 'fixed' && input.value < 0) {
    return 'Fixed discounts must not be negative.';
  }
  if (!DATE_ONLY.test(input.start_date ?? '') || !isValidDateOnly(input.start_date)) {
    return 'A valid start date is required.';
  }
  if (input.end_date != null && input.end_date !== '') {
    if (!DATE_ONLY.test(input.end_date) || !isValidDateOnly(input.end_date)) {
      return 'End date must be a valid date.';
    }
    if (input.end_date <= input.start_date) return 'End date must be after the start date.';
  }
  if (!input.contract_line_id) return 'Select the contract line this discount applies to.';
  const validScopes: DiscountAuthoringScope[] = ['invoice', 'contract', 'service', 'item'];
  if (!validScopes.includes(input.scope)) return 'Choose a supported discount scope.';
  if (input.scope === 'item') {
    // Item scope targets a single invoice charge row, whose id is generated per
    // invoice; it cannot be authored against a stable contract configuration.
    return 'Item-scoped discounts cannot be authored here; choose invoice, contract or service scope.';
  }
  if (input.scope === 'service' && !input.scope_service_id) {
    return 'Select the service this discount applies to.';
  }
  if (input.priority != null && !Number.isInteger(input.priority)) {
    return 'Priority must be a whole number.';
  }
  return null;
}

/**
 * Converts the authoring value to the `discounts.value` storage convention.
 * `discounts.value` is `decimal(10,4)`, so fractional percentages survive
 * exactly (12.5% -> 0.125); fixed amounts keep two decimal currency places.
 */
export function toStoredDiscountValue(input: Pick<DiscountAuthoringInput, 'discount_type' | 'value'>): number {
  return input.discount_type === 'percentage'
    ? Math.round((input.value / 100) * 1e4) / 1e4
    : Math.round(input.value * 100) / 100;
}

/** Converts a stored value back to the authoring units shown in the editor. */
export function toDisplayDiscountValue(
  discountType: 'percentage' | 'fixed',
  storedValue: number,
): number {
  return discountType === 'percentage' ? storedValue * 100 : storedValue;
}
