import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../src/components/billing-dashboard/contracts/ContractDetail.tsx', import.meta.url),
  'utf8'
);

describe('ContractDetail assignment renewal settings wiring', () => {
  it('renders renewal settings controls while editing assignments', () => {
    expect(source).toContain('Use tenant renewal defaults');
    expect(source).toContain('assignment-renewal-mode-');
    expect(source).toContain('assignment-notice-period-');
    expect(source).toContain('assignment-renewal-term-');
  });

  it('persists edited renewal fields on save', () => {
    expect(source).toContain('updatePayload.use_tenant_renewal_defaults');
    expect(source).toContain('updatePayload.renewal_mode');
    expect(source).toContain('updatePayload.notice_period_days');
    expect(source).toContain('updatePayload.renewal_term_months');
  });
});

