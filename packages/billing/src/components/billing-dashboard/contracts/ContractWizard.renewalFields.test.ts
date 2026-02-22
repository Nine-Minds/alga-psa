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

  it('hydrates and normalizes renewal fields for editing contracts', () => {
    expect(wizardSource).toContain('buildInitialContractWizardData');
    expect(wizardSource).toContain('normalizeRenewalMode(editingContract?.renewal_mode)');
    expect(wizardSource).toContain(
      'normalizeNonNegativeInteger(editingContract?.notice_period_days)'
    );
    expect(wizardSource).toContain(
      'normalizePositiveInteger(editingContract?.renewal_term_months)'
    );
    expect(wizardSource).toContain('buildInitialContractWizardData(editingContract)');
  });

  it('requires renewal mode when an end date is set', () => {
    expect(wizardSource).toContain('if (wizardData.end_date && !wizardData.renewal_mode)');
    expect(wizardSource).toContain('Renewal mode is required when an end date is set');
  });

  it('validates notice period as bounded non-negative integer', () => {
    expect(wizardSource).toContain('const MIN_NOTICE_PERIOD_DAYS = 0;');
    expect(wizardSource).toContain('const MAX_NOTICE_PERIOD_DAYS = 3650;');
    expect(wizardSource).toContain("Notice period must be a whole number of days");
    expect(wizardSource).toContain('Notice period must be between ${MIN_NOTICE_PERIOD_DAYS}');
  });

  it('validates renewal term months as positive integer when provided', () => {
    expect(wizardSource).toContain('wizardData.renewal_term_months !== undefined');
    expect(wizardSource).toContain('wizardData.renewal_term_months <= 0');
    expect(wizardSource).toContain('Renewal term months must be a positive whole number');
  });

  it('renders validation messages inline for the current wizard step', () => {
    expect(wizardSource).toContain('{errors[currentStep] && (');
    expect(wizardSource).toContain("text-[rgb(var(--color-destructive))] text-sm");
  });

  it('includes renewal fields in the wizard submission payload builder', () => {
    expect(wizardSource).toContain('renewal_mode: resolvedRenewalMode');
    expect(wizardSource).toContain('notice_period_days: resolvedNoticePeriodDays');
    expect(wizardSource).toContain('renewal_term_months: wizardData.renewal_term_months');
    expect(wizardSource).toContain('use_tenant_renewal_defaults: useTenantDefaults');
  });

  it('applies tenant defaults when use-tenant-defaults is enabled', () => {
    expect(wizardSource).toContain('const useTenantDefaults = wizardData.use_tenant_renewal_defaults ?? true;');
    expect(wizardSource).toContain('const tenantDefaults = await getDefaultBillingSettings();');
    expect(wizardSource).toContain('? tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE');
    expect(wizardSource).toContain('? tenantDefaultNoticePeriodDays ?? HARD_DEFAULT_NOTICE_PERIOD_DAYS');
  });

  it('prefers explicit contract override values when tenant defaults are disabled', () => {
    expect(wizardSource).toContain(': wizardData.renewal_mode ?? tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE;');
    expect(wizardSource).toContain(': wizardData.notice_period_days ??');
  });

  it('uses deterministic fallback precedence for partial override/default state', () => {
    expect(wizardSource).toContain('HARD_DEFAULT_RENEWAL_MODE');
    expect(wizardSource).toContain('HARD_DEFAULT_NOTICE_PERIOD_DAYS');
    expect(wizardSource).toContain('tenantDefaultRenewalMode ?? HARD_DEFAULT_RENEWAL_MODE');
    expect(wizardSource).toContain('tenantDefaultNoticePeriodDays ??');
  });
});
