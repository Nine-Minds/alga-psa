import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const servicePath = resolve(__dirname, '../../../lib/api/services/FinancialService.ts');
const source = readFileSync(servicePath, 'utf8');

function sectionBetween(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);

  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);

  return source.slice(start, end);
}

describe('financial service payment methods tenant-scoped query contract', () => {
  it('uses structural tenant scoping for payment-method list roots', () => {
    const paymentMethodSection = sectionBetween('async listPaymentMethods', '// FINANCIAL REPORTING');

    expect(paymentMethodSection).toContain('tenantDb(');
    expect(paymentMethodSection).toContain(".table('payment_methods as pm')");
    expect(paymentMethodSection).toContain(".andOn('pm.tenant', '=', 'c.tenant')");

    expect(paymentMethodSection).not.toMatch(/knex\('payment_methods as pm'\)\s*\./);
    expect(paymentMethodSection).not.toMatch(/\.where\('pm\.tenant', context\.tenant\)/);
  });
});
