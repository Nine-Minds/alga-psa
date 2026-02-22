import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../src/actions/contractActions.ts', import.meta.url), 'utf8');

describe('contractActions assignment renewal fields wiring', () => {
  it('selects renewal columns when loading contract assignments', () => {
    expect(source).toContain("'cc.renewal_mode'");
    expect(source).toContain("'cc.notice_period_days'");
    expect(source).toContain("'cc.renewal_term_months'");
    expect(source).toContain("'cc.use_tenant_renewal_defaults'");
    expect(source).toContain("'cc.decision_due_date'");
    expect(source).toContain("'dbs.default_renewal_mode as tenant_default_renewal_mode'");
    expect(source).toContain("'dbs.default_notice_period_days as tenant_default_notice_period_days'");
  });

  it('maps effective renewal settings into assignment summaries', () => {
    expect(source).toContain('effective_renewal_mode: useTenantRenewalDefaults');
    expect(source).toContain('effective_notice_period_days: useTenantRenewalDefaults');
    expect(source).toContain('decision_due_date: row.decision_due_date ? new Date(row.decision_due_date).toISOString().split(\'T\')[0] : null');
  });
});

