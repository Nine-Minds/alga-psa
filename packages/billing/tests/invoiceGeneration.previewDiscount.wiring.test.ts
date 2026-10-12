import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { WasmInvoiceViewModel } from '@alga-psa/types';
import { applyInvoiceDiscountSummary } from '../src/lib/adapters/invoiceAdapters';

// alga0002295. `adaptToWasmViewModel` is private to a 'use server' module that needs a live DB
// for tenant lookups, so the assembly is pinned by source contract plus a behavioural check of
// the helper on a preview-shaped model.
describe('preview view model discount summary', () => {
  const source = readFileSync(resolve(__dirname, '../src/actions/invoiceGeneration.ts'), 'utf8');

  it('flags preview discount lines and derives the summary before returning', () => {
    expect(source).toMatch(/id: `preview-discount-\$\{discount\.discount_id\}`[\s\S]{0,200}isDiscount: true/);
    const adapter = source.slice(source.indexOf('async function adaptToWasmViewModel'));
    expect(adapter.indexOf('applyInvoiceDiscountSummary(previewViewModel)')).toBeGreaterThan(0);
    expect(adapter.indexOf('applyInvoiceDiscountSummary(previewViewModel)')).toBeLessThan(
      adapter.indexOf('return previewViewModel;'),
    );
  });

  it('derives discountTotal / grossSubtotal for a preview-shaped model', () => {
    // Preview discount amounts are signed negative (`Math.round(-discount.amount)`) and
    // `subtotal` is already net (`totalAmount + discountAdjustment`).
    const vm = applyInvoiceDiscountSummary({
      items: [
        { id: 'charge-1', description: 'Service', quantity: 1, unitPrice: 10000, total: 10000 },
        { id: 'preview-discount-d1', description: 'Promo', quantity: 1, unitPrice: -2000, total: -2000, isDiscount: true },
      ],
      subtotal: 8000,
      tax: 800,
      total: 8800,
    } as unknown as WasmInvoiceViewModel);
    expect(vm.discountTotal).toBe(2000);
    expect(vm.grossSubtotal).toBe(10000);
    expect(vm.subtotal).toBe(8000);
  });
});
