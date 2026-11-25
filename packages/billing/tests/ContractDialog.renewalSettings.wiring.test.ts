import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDialog.tsx', import.meta.url),
  'utf8'
);

describe('ContractDialog renewal settings wiring', () => {
  it('renders renewal settings controls in quick add', () => {
    expect(source).toContain('Renewal Settings');
    expect(source).toContain('id="quick-add-use-tenant-renewal-defaults"');
    expect(source).toContain('id="quick-add-renewal-mode"');
    expect(source).toContain('id="quick-add-notice-period-days"');
    expect(source).toContain('id="quick-add-renewal-term-months"');
  });

  it('includes renewal fields in the single quick-add save', () => {
    expect(source).toContain('saveQuickAddContract({');
    expect(source).toContain('use_tenant_renewal_defaults: useTenantRenewalDefaults');
    expect(source).toContain('renewal_mode: useTenantRenewalDefaults ? undefined : renewalMode');
    expect(source).toContain("notice_period_days:");
    expect(source).toContain("renewal_term_months:");
  });

  // Defect 2: `startDate.toISOString()` is the previous day east of UTC.
  it('sends the picked local calendar dates', () => {
    expect(source).toContain('start_date: dateToString(startDate)');
    expect(source).toContain('end_date: endDate ? dateToString(endDate) : null');
    expect(source).not.toContain('toISOString');
  });
});

