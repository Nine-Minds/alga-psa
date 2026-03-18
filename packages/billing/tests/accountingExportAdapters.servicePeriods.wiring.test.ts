import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const quickBooksSource = readFileSync(
  new URL('../src/adapters/accounting/quickBooksOnlineAdapter.ts', import.meta.url),
  'utf8'
);
const xeroSource = readFileSync(
  new URL('../src/adapters/accounting/xeroAdapter.ts', import.meta.url),
  'utf8'
);

describe('accounting export adapter service-period wiring', () => {
  it('uses exported line service periods when building QuickBooks Online payloads', () => {
    expect(quickBooksSource).toContain("line.payload?.service_period_source === 'financial_document_fallback'");
    expect(quickBooksSource).toContain('return line.service_period_start ?? line.service_period_end ?? null;');
    expect(quickBooksSource).toContain('salesDetail.ServiceDate = formatted;');
  });

  it('carries exported line service periods through Xero payloads', () => {
    expect(xeroSource).toContain("line.payload?.service_period_source === 'financial_document_fallback'");
    expect(xeroSource).toContain('servicePeriodStart: servicePeriod.servicePeriodStart,');
    expect(xeroSource).toContain('servicePeriodEnd: servicePeriod.servicePeriodEnd');
  });
});
