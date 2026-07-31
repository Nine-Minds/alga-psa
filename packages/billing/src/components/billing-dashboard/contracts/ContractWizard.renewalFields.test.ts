import { readFileSync } from 'node:fs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ContractWizardData } from './ContractWizard';

// Formatting-agnostic source contract: Prettier passes on ContractWizard.tsx
// keep flipping quote style and re-wrapping call sites, which are not what
// these tests guard. Both the source and every expected snippet go through
// the same normalization (double->single quotes, all whitespace removed,
// trailing commas before ')' dropped) so only real code changes fail.
const normalizeSource = (code: string): string =>
  code.replace(/"/g, "'").replace(/\s+/g, '').replace(/,\)/g, ')');

const wizardSource = normalizeSource(
  readFileSync(new URL('./ContractWizard.tsx', import.meta.url), 'utf8')
);

const expectWizardContains = (snippet: string): void => {
  expect(wizardSource).toContain(normalizeSource(snippet));
};

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
    expectWizardContains('createDefaultContractWizardData');
    expectWizardContains("renewal_mode: 'manual'");
    expectWizardContains('notice_period_days: 30');
    expectWizardContains('renewal_term_months: undefined');
    expectWizardContains('use_tenant_renewal_defaults: true');
  });

  it('hydrates and normalizes renewal fields for editing contracts', () => {
    expectWizardContains('buildInitialContractWizardData');
    expectWizardContains('normalizeRenewalMode(editingContract?.renewal_mode)');
    expectWizardContains('normalizeNonNegativeInteger(editingContract?.notice_period_days)');
    expectWizardContains('normalizePositiveInteger(editingContract?.renewal_term_months)');
    expectWizardContains('buildInitialContractWizardData(editingContract)');
  });

  it('requires renewal mode when an end date is set', () => {
    expectWizardContains('if (wizardData.end_date && !wizardData.renewal_mode)');
    expectWizardContains('Renewal mode is required when an end date is set');
  });

  it('validates notice period as bounded non-negative integer', () => {
    expectWizardContains('const MIN_NOTICE_PERIOD_DAYS = 0;');
    expectWizardContains('const MAX_NOTICE_PERIOD_DAYS = 3650;');
    expectWizardContains("Notice period must be a whole number of days");
    // The bounds message is translated with i18n interpolation since the i18n sweep.
    expectWizardContains("defaultValue: 'Notice period must be between {{min}} and {{max}} days'");
    expectWizardContains('min: MIN_NOTICE_PERIOD_DAYS');
    expectWizardContains('max: MAX_NOTICE_PERIOD_DAYS');
  });

  it('validates renewal term months as positive integer when provided', () => {
    expectWizardContains('wizardData.renewal_term_months !== undefined');
    expectWizardContains('wizardData.renewal_term_months <= 0');
    expectWizardContains('Renewal term months must be a positive whole number');
  });

  it('renders validation messages inline for the current wizard step', () => {
    expectWizardContains('{errors[currentStep] && (');
    expectWizardContains("text-[rgb(var(--color-destructive))] text-sm");
  });

  it('includes renewal fields in the wizard submission payload builder', () => {
    expectWizardContains('renewal_mode: resolvedRenewalMode');
    expectWizardContains('notice_period_days: resolvedNoticePeriodDays');
    expectWizardContains('renewal_term_months: wizardData.renewal_term_months');
    expectWizardContains('use_tenant_renewal_defaults: useTenantDefaults');
  });

  it('applies tenant defaults when use-tenant-defaults is enabled', () => {
    expectWizardContains('const useTenantDefaults = wizardData.use_tenant_renewal_defaults ?? true;');
    expectWizardContains('const tenantDefaults = await getDefaultBillingSettings();');
    expectWizardContains('? tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE');
    expectWizardContains('? tenantDefaultNoticePeriodDays ?? HARD_DEFAULT_NOTICE_PERIOD_DAYS');
  });

  it('prefers explicit contract override values when tenant defaults are disabled', () => {
    expectWizardContains(': (wizardData.renewal_mode ?? tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE);');
    expectWizardContains(': (wizardData.notice_period_days ??');
  });

  it('uses deterministic fallback precedence for partial override/default state', () => {
    expectWizardContains('HARD_DEFAULT_RENEWAL_MODE');
    expectWizardContains('HARD_DEFAULT_NOTICE_PERIOD_DAYS');
    expectWizardContains('tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE');
    expectWizardContains('tenantDefaultNoticePeriodDays ??');
  });
});
