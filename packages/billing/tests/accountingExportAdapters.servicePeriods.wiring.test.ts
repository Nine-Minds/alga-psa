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
    expect(quickBooksSource).toContain('const serviceDate = line.service_period_start ?? line.service_period_end;');
    expect(quickBooksSource).toContain('salesDetail.ServiceDate = formatted;');
  });

  it('carries exported line service periods through Xero payloads', () => {
    expect(xeroSource).toContain('servicePeriodStart: line.service_period_start ?? null,');
    expect(xeroSource).toContain('servicePeriodEnd: line.service_period_end ?? null');
  });
});
