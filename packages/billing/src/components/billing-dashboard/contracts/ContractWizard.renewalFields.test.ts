import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ContractWizardData } from './ContractWizard';

const wizardSource = readFileSync(new URL('./ContractWizard.tsx', import.meta.url), 'utf8');

describe('ContractWizardData renewal fields', () => {
  it('includes renewal configuration fields with expected types', () => {
    expectTypeOf<ContractWizardData>().toMatchTypeOf<{
      renewal_mode?: 'none' | 'manual' | 'auto';
      notice_period_days?: number;
      renewal_term_months?: number;
      use_tenant_renewal_defaults?: boolean;
    }>();
  });

  it('accepts all supported renewal modes', () => {
    const supportedModes: Array<NonNullable<ContractWizardData['renewal_mode']>> = [
      'none',
      'manual',
      'auto',
    ];

    expect(supportedModes).toEqual(['none', 'manual', 'auto']);
  });

  it('initializes renewal defaults for new contracts', () => {
    expect(wizardSource).toContain('createDefaultContractWizardData');
    expect(wizardSource).toContain("renewal_mode: 'manual'");
    expect(wizardSource).toContain('notice_period_days: 30');
    expect(wizardSource).toContain('renewal_term_months: undefined');
    expect(wizardSource).toContain('use_tenant_renewal_defaults: true');
  });
});
