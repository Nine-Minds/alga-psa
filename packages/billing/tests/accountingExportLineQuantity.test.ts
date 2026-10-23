import { describe, expect, it } from 'vitest';
import { reconcileExportLineQuantity } from '../src/adapters/accounting/exportLineQuantity';

const qbo = (quantity: unknown, unitPriceCents: number | null, amountCents: number) =>
  reconcileExportLineQuantity({ quantity, unitPriceCents, amountCents, maxQuantityDecimals: 6 });
const xero = (quantity: unknown, unitPriceCents: number | null, amountCents: number) =>
  reconcileExportLineQuantity({ quantity, unitPriceCents, amountCents, maxQuantityDecimals: 4 });

const productCents = (line: { quantity: number; unitPriceCents: number }) =>
  line.quantity * line.unitPriceCents;

describe('reconcileExportLineQuantity', () => {
  it('keeps a stored pair that already multiplies to the amount', () => {
    expect(qbo('0.25', 12500, 3125)).toEqual({ quantity: 0.25, unitPriceCents: 12500, strategy: 'stored' });
    expect(qbo(2, 5000, 10000).strategy).toBe('stored');
  });

  it('derives hours at the real rate when stored hours were rounded (5 min at $125/h)', () => {
    const line = qbo('0.08', 12500, 1042);
    expect(line).toEqual({ quantity: 0.08336, unitPriceCents: 12500, strategy: 'derived' });
    expect(Math.abs(productCents(line) - 1042)).toBeLessThanOrEqual(0.1);
  });

  it('derives for other odd-minute entries', () => {
    // 20 min and 10 min at $150/h
    expect(qbo('0.33', 15000, 5000)).toMatchObject({ quantity: 0.33333, strategy: 'derived' });
    expect(qbo('0.17', 15000, 2500)).toMatchObject({ quantity: 0.16667, strategy: 'derived' });
  });

  it('falls back to a single lump line when the target keeps too few decimals', () => {
    expect(xero('0.08', 12500, 1042)).toEqual({ quantity: 1, unitPriceCents: 1042, strategy: 'lump' });
  });

  it('does not invent hours for a blended overtime line', () => {
    // 8h05m, 8h at $100 + 5 min at $150 = $812.50; amount / rate = 8.125 h was never worked
    expect(qbo('8.08', 10000, 81250)).toEqual({ quantity: 1, unitPriceCents: 81250, strategy: 'lump' });
  });

  it('lumps bucket overage stored as quantity 1 and keeps it once hours are stored', () => {
    expect(qbo('1.00', 15000, 37500).strategy).toBe('lump');
    expect(qbo('2.50', 15000, 37500)).toEqual({ quantity: 2.5, unitPriceCents: 15000, strategy: 'stored' });
  });

  it('lumps discounts with no usable unit price', () => {
    expect(qbo('1', 0, -500)).toEqual({ quantity: 1, unitPriceCents: -500, strategy: 'lump' });
    expect(qbo('3', -1000, -1000)).toEqual({ quantity: 1, unitPriceCents: -1000, strategy: 'lump' });
    expect(qbo('1', -1000, -1000).strategy).toBe('stored');
  });

  it('keeps zero-amount informational lines and treats a missing quantity as 1', () => {
    expect(qbo('4.50', 0, 0)).toEqual({ quantity: 4.5, unitPriceCents: 0, strategy: 'stored' });
    expect(qbo(null, 2500, 2500)).toEqual({ quantity: 1, unitPriceCents: 2500, strategy: 'stored' });
    expect(qbo('1', null, 2500)).toEqual({ quantity: 1, unitPriceCents: 2500, strategy: 'lump' });
  });

  it('always returns a pair that reproduces the amount for every whole-minute entry', () => {
    for (const rate of [7500, 12500, 15000, 17550, 29900]) {
      for (let minutes = 1; minutes <= 600; minutes++) {
        const amount = Math.round((minutes / 60) * rate);
        const stored = (Math.round((minutes / 60) * 100) / 100).toFixed(2);
        for (const line of [qbo(stored, rate, amount), xero(stored, rate, amount)]) {
          expect(Math.round(productCents(line))).toBe(amount);
          if (line.strategy === 'derived') {
            expect(Math.abs(productCents(line) - amount)).toBeLessThanOrEqual(0.1);
          }
        }
      }
    }
  });
});
