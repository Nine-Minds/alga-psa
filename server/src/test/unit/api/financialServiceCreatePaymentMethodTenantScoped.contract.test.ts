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

describe('financial service create payment method tenant-scoped query contract', () => {
  it('uses structural tenant scoping for default payment-method reset roots', () => {
    const paymentMethodSection = sectionBetween('async createPaymentMethod', 'async listPaymentMethods');

    expect(paymentMethodSection).toContain('createTenantScopedQuery(trx, {');
    expect(paymentMethodSection).toContain("table: 'payment_methods'");

    expect(paymentMethodSection).not.toMatch(/trx\('payment_methods'\)\s*\.(?:where|update|delete)/);
    expect(paymentMethodSection).not.toMatch(/where\(\{\s*[^}]*tenant\s*[,}]/);
  });
});
