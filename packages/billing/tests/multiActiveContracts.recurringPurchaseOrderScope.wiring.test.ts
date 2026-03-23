import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('multi-active recurring PO scope wiring', () => {
  it('T044: recurring due-work grouping keeps purchaseOrderScopeKey bound to client_contract_id', () => {
    const source = readFileSync(
      resolve(__dirname, '../src/actions/billingAndTax.ts'),
      'utf8',
    );

    expect(source).toContain('purchaseOrderScopeKey: row.client_contract_id ?? null');
    expect(source).toContain('groupDueServicePeriodsForInvoiceCandidates(');
    expect(source).toContain('purchaseOrderScopeKey:');
    expect(source).toContain('splitReasons');
  });
});
