import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { ONBOARDING_WIZARD_STEPS } from '@alga-psa/types';
import {
  getOnboardingWizardRequiredStepPositions,
  getOnboardingWizardStepIndexes,
} from '@alga-psa/onboarding/lib';

describe('AlgaDesk onboarding wizard product steps', () => {
  it('preserves the full PSA wizard step list', () => {
    const stepIndexes = getOnboardingWizardStepIndexes('psa');

    expect(stepIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(stepIndexes.map((index) => ONBOARDING_WIZARD_STEPS[index])).toEqual([
      'Client Info',
      'Team Members',
      'Add Client',
      'Client Contact',
      'Billing',
      'Ticketing',
    ]);
    expect(getOnboardingWizardRequiredStepPositions('psa')).toEqual([0, 5]);
  });

  it('removes Billing from AlgaDesk while keeping help-desk setup and required ticketing', () => {
    const stepIndexes = getOnboardingWizardStepIndexes('algadesk');
    const stepLabels = stepIndexes.map((index) => ONBOARDING_WIZARD_STEPS[index]);

    expect(stepLabels).toEqual([
      'Client Info',
      'Team Members',
      'Add Client',
      'Client Contact',
      'Ticketing',
    ]);
    expect(stepLabels).not.toContain('Billing');
    expect(getOnboardingWizardRequiredStepPositions('algadesk')).toEqual([0, 4]);
  });

  it('keeps AlgaDesk-specific wizard shell copy in the shared wizard source', () => {
    const source = readFileSync(
      join(process.cwd(), '../packages/onboarding/src/components/OnboardingWizard.tsx'),
      'utf8'
    );

    expect(source).toContain("onboardingWizard.shell.algadeskTitle");
    expect(source).toContain('Set Up AlgaDesk');
    expect(source).toContain('Configure your help desk workspace, clients, and ticketing defaults.');
  });

  it('defines AlgaDesk onboarding translation keys for every locale', () => {
    const localesRoot = join(process.cwd(), 'public/locales');
    const locales = readdirSync(localesRoot);

    for (const locale of locales) {
      const source = readFileSync(join(localesRoot, locale, 'msp/onboarding.json'), 'utf8');
      const messages = JSON.parse(source);

      expect(messages.onboardingWizard.steps.algadeskWorkspace, locale).toBeTruthy();
      expect(messages.onboardingWizard.shell.algadeskTitle, locale).toBeTruthy();
      expect(messages.onboardingWizard.shell.algadeskDescription, locale).toBeTruthy();
    }
  });

  it('wires the MSP onboarding page to pass productCode into OnboardingWizard', () => {
    const source = readFileSync(
      join(process.cwd(), 'src/app/msp/onboarding/page.tsx'),
      'utf8'
    );

    expect(source).toContain("import { useProduct } from '@/context/ProductContext';");
    expect(source).toContain('const { productCode } = useProduct();');
    expect(source).toContain('productCode={productCode}');
  });
});
