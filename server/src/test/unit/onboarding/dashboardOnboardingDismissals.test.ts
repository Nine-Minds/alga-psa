import { describe, expect, it } from 'vitest';
import {
  getDismissedStepIdsFromTenantSettings,
  setDismissedStepIdsInTenantSettings,
} from '@alga-psa/onboarding/lib/dashboardOnboardingDismissals';

describe('dashboard onboarding dismissal settings helpers', () => {
  it('normalizes dismissed step ids from tenant settings', () => {
    const dismissedStepIds = getDismissedStepIdsFromTenantSettings({
      dashboardOnboarding: {
        dismissedStepIds: [
          'identity_sso',
          'identity_sso',
          'managed_email',
          'unknown-step',
          null,
        ],
      },
    });

    expect(dismissedStepIds).toEqual(['identity_sso', 'managed_email']);
  });

  it('handles stringified settings payloads', () => {
    const settings = JSON.stringify({
      dashboardOnboarding: {
        dismissedStepIds: ['data_import'],
      },
    });

    expect(getDismissedStepIdsFromTenantSettings(settings)).toEqual(['data_import']);
  });

  it('merges dismissal settings while preserving existing tenant settings', () => {
    const nextSettings = setDismissedStepIdsInTenantSettings(
      {
        experimentalFeatures: {
          aiAssistant: false,
        },
        dashboardOnboarding: {
          someExistingSetting: true,
        },
      },
      ['calendar_sync', 'managed_email']
    );

    expect(nextSettings).toMatchObject({
      experimentalFeatures: {
        aiAssistant: false,
      },
      dashboardOnboarding: {
        someExistingSetting: true,
        dismissedStepIds: ['calendar_sync', 'managed_email'],
      },
    });
  });
});
