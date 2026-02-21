import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ContractWizardData } from './ContractWizard';

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
});
