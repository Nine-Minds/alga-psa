import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./contractWizardActions.ts', import.meta.url), 'utf8');

describe('contractWizardActions draft renewal hydration wiring', () => {
  it('includes renewal fields on DraftContractWizardData', () => {
    expect(source).toContain("renewal_mode?: 'none' | 'manual' | 'auto';");
    expect(source).toContain('notice_period_days?: number;');
    expect(source).toContain('renewal_term_months?: number;');
    expect(source).toContain('use_tenant_renewal_defaults?: boolean;');
  });

  it('hydrates renewal fields from client contract row in getDraftContractForResume', () => {
    expect(source).toContain('const renewalMode =');
    expect(source).toContain('const noticePeriodDays =');
    expect(source).toContain('const renewalTermMonths =');
    expect(source).toContain('renewal_mode: renewalMode');
    expect(source).toContain('notice_period_days: noticePeriodDays');
    expect(source).toContain('renewal_term_months: renewalTermMonths');
    expect(source).toContain('use_tenant_renewal_defaults:');
  });

  it('sanitizes numeric renewal draft values before returning wizard payload', () => {
    expect(source).toContain('Math.max(0, Math.trunc(Number(noticePeriodRaw)))');
    expect(source).toContain('Math.trunc(Number(renewalTermRaw)) > 0');
  });
});
