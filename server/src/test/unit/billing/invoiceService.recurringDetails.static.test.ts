import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('invoiceService recurring detail persistence regression guards', () => {
  const source = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../../../../../packages/billing/src/services/invoiceService.ts',
    ),
    'utf8',
  );

  it('normalizes recurring charge quantity and rate before writing invoice_charge_details', () => {
    expect(source).toContain('const detailQuantity = Number(charge.quantity ?? 1) || 1;');
    expect(source).toContain('const detailRate = Number(charge.rate ?? 0) || 0;');
    expect(source).toContain('quantity: detailQuantity');
    expect(source).toContain('rate: detailRate');
  });

  it('links and marks source usage and time records when invoice charges are persisted', () => {
    expect(source).toContain("async function linkAndMarkSourceBillingRecord");
    expect(source).toContain("tx('time_entries')");
    expect(source).toContain("tx('invoice_time_entries').insert");
    expect(source).toContain("tx('usage_tracking')");
    expect(source).toContain("tx('invoice_usage_records').insert");
    expect(source).toContain("await linkAndMarkSourceBillingRecord({");
  });
});
