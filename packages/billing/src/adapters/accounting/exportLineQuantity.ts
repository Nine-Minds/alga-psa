/**
 * Accounting systems validate each invoice line as quantity × unit price =
 * amount (QuickBooks faults the whole invoice with 6070 otherwise). Alga's
 * amount is authoritative and is not always the product of the stored pair:
 * hours are stored rounded while the amount is computed from whole minutes,
 * overtime blends two rates, percentage discounts carry no unit price.
 * This picks a quantity and unit price that multiply back to the amount.
 */

export type ExportLineQuantityStrategy = 'stored' | 'derived' | 'lump';

export interface ExportLineQuantityInput {
  /** Stored charge quantity; numeric columns arrive as strings. */
  quantity: unknown;
  unitPriceCents: number | null;
  amountCents: number;
  /** Most decimal places the target system keeps on a line quantity. */
  maxQuantityDecimals: number;
}

export interface ExportLineQuantity {
  quantity: number;
  unitPriceCents: number;
  strategy: ExportLineQuantityStrategy;
}

// A derived quantity must reproduce the amount this closely (in cents) so the
// result does not depend on how the target system rounds half cents.
const DERIVED_TOLERANCE_CENTS = 0.1;
// A derived quantity must still read as the stored one; otherwise the line is
// not "quantity at this rate" at all (overtime, bucket overage stored as 1).
const STORED_QUANTITY_TOLERANCE = 0.005;
const STORED_QUANTITY_DECIMALS = 2;

export function reconcileExportLineQuantity(input: ExportLineQuantityInput): ExportLineQuantity {
  const { amountCents, unitPriceCents } = input;
  const storedQuantity = coerceQuantity(input.quantity);

  if (unitPriceCents === null) {
    return { quantity: 1, unitPriceCents: amountCents, strategy: 'lump' };
  }

  const quantity = storedQuantity ?? 1;
  if (Math.round(quantity * unitPriceCents) === amountCents) {
    return { quantity, unitPriceCents, strategy: 'stored' };
  }

  if (unitPriceCents !== 0) {
    const exact = amountCents / unitPriceCents;
    for (let decimals = STORED_QUANTITY_DECIMALS; decimals <= input.maxQuantityDecimals; decimals++) {
      const candidate = roundTo(exact, decimals);
      if (
        candidate > 0 &&
        Math.abs(candidate - quantity) <= STORED_QUANTITY_TOLERANCE + Number.EPSILON &&
        Math.abs(candidate * unitPriceCents - amountCents) <= DERIVED_TOLERANCE_CENTS
      ) {
        return { quantity: candidate, unitPriceCents, strategy: 'derived' };
      }
    }
  }

  return { quantity: 1, unitPriceCents: amountCents, strategy: 'lump' };
}

function coerceQuantity(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
