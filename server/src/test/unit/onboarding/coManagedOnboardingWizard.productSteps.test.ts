import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_WIZARD_STEPS } from '@alga-psa/types';
import {
  getOnboardingWizardRequiredStepPositions,
  getOnboardingWizardStepIndexes,
} from '@alga-psa/onboarding/lib';

describe('Co-managed onboarding wizard product steps', () => {
  it('keeps a co-managed customer workspace out of the commercial MSP steps', () => {
    const stepIndexes = getOnboardingWizardStepIndexes('co_managed');
    const stepLabels = stepIndexes.map((index) => ONBOARDING_WIZARD_STEPS[index]);

    expect(stepLabels).toEqual([
      'Client Info',
      'Team Members',
      'Ticketing',
    ]);
    // The customer SKU has no contracts, billing rates, or invoice setup, and
    // provisioning already created the workspace's own organization and contact.
    expect(stepLabels).not.toContain('Billing');
    expect(stepLabels).not.toContain('Add Client');
    expect(stepLabels).not.toContain('Client Contact');
  });

  it('marks workspace identity and ticketing required at their co-managed display positions', () => {
    expect(getOnboardingWizardRequiredStepPositions('co_managed')).toEqual([0, 2]);
  });

  it('leaves the PSA and AlgaDesk step sets untouched', () => {
    expect(getOnboardingWizardStepIndexes('psa')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(getOnboardingWizardStepIndexes('algadesk')).toEqual([0, 1, 2, 3, 5]);
  });

  it('keeps co-managed wizard shell copy in the shared wizard source', () => {
    const source = readFileSync(
      join(process.cwd(), '../packages/onboarding/src/components/OnboardingWizard.tsx'),
      'utf8'
    );

    expect(source).toContain('onboardingWizard.shell.coManagedTitle');
    expect(source).toContain('Set Up Your IT Workspace');
    expect(source).toContain('onboardingWizard.shell.coManagedDescription');
    expect(source).toContain('Configure your workspace, your IT team, and your ticketing defaults.');
    expect(source).toContain('onboardingWizard.steps.coManagedWorkspace');
  });

  it('defines co-managed onboarding translation keys for every locale', () => {
    const localesRoot = join(process.cwd(), 'public/locales');
    // Directories only — a stray .DS_Store next to the locale folders would
    // otherwise be read as a locale and blow up with ENOTDIR.
    const locales = readdirSync(localesRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);

    expect(locales.length).toBe(10);

    for (const locale of locales) {
      const source = readFileSync(join(localesRoot, locale, 'msp/onboarding.json'), 'utf8');
      const messages = JSON.parse(source);

      expect(messages.onboardingWizard.steps.coManagedWorkspace, locale).toBeTruthy();
      expect(messages.onboardingWizard.shell.coManagedTitle, locale).toBeTruthy();
      expect(messages.onboardingWizard.shell.coManagedDescription, locale).toBeTruthy();
      // Step-0 body copy: a co-managed customer is not an MSP and has no invoices.
      expect(messages.clientInfoStep.header.coManagedTitle, locale).toBeTruthy();
      expect(messages.clientInfoStep.header.coManagedDescription, locale).toBeTruthy();
      expect(messages.clientInfoStep.address.coManagedDescription, locale).toBeTruthy();
    }
  });

  it('never shows a co-managed customer MSP-operator or billing copy on step 0', () => {
    const source = readFileSync(
      join(process.cwd(), '../packages/onboarding/src/components/steps/ClientInfoStep.tsx'),
      'utf8'
    );
    const messages = JSON.parse(
      readFileSync(join(process.cwd(), 'public/locales/en/msp/onboarding.json'), 'utf8')
    );

    // The step must choose its copy by product, not hardcode the MSP wording.
    expect(source).toContain('CLIENT_INFO_COPY_BY_PRODUCT');
    expect(source).toContain('clientInfoStep.header.coManagedTitle');
    expect(source).toContain('clientInfoStep.address.coManagedDescription');

    const coManagedCopy = [
      messages.clientInfoStep.header.coManagedTitle,
      messages.clientInfoStep.header.coManagedDescription,
      messages.clientInfoStep.address.coManagedDescription,
    ].join(' ');
    // "MSP" frames the reader as the service provider; invoices/quotes/billing do
    // not exist in this SKU at all — the Billing step is removed for that reason.
    for (const forbidden of ['MSP', 'invoice', 'quote', 'billing']) {
      expect(coManagedCopy.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }

    // ...while PSA keeps the operator-facing wording it has always had.
    expect(messages.clientInfoStep.header.description).toContain('MSP');
  });
});
