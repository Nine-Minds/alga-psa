import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./ContractBasicsStep.tsx', import.meta.url), 'utf8');

describe('ContractBasicsStep renewal card rendering', () => {
  it('renders the fixed-term Renewal Settings card when end date is present', () => {
    expect(source).toContain('{data.end_date && (');
    expect(source).toContain('data-automation-id="renewal-settings-fixed-term-card"');
    expect(source).toContain('Renewal Settings');
  });

  it('renders the evergreen review card when end date is absent', () => {
    expect(source).toContain('{!data.end_date && (');
    expect(source).toContain('data-automation-id="renewal-settings-evergreen-card"');
    expect(source).toContain('Evergreen Review Settings');
  });

  it('defines renewal mode selector options for none/manual/auto', () => {
    expect(source).toContain("const renewalModeOptions = [");
    expect(source).toContain("{ value: 'none', label: 'No Renewal' }");
    expect(source).toContain("{ value: 'manual', label: 'Manual Renewal' }");
    expect(source).toContain("{ value: 'auto', label: 'Auto Renew' }");
    expect(source).toContain('renewal_mode: value as NonNullable<ContractWizardData');
  });

  it('shows notice period input only for renewal-enabled modes', () => {
    expect(source).toContain("const isRenewalEnabled = effectiveRenewalMode !== 'none';");
    expect(source).toContain('{isRenewalEnabled && (');
    expect(source).toContain('id="notice-period-fixed"');
    expect(source).toContain('id="notice-period-evergreen"');
    expect(source).toContain('notice_period_days: Number.isFinite(parsed)');
  });
});
