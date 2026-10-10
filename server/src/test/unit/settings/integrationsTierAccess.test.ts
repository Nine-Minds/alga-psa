import { describe, expect, it } from 'vitest';
import { getSettingsTab } from '@/components/settings/settingsTabsRegistry';
import { FEATURE_MINIMUM_TIER, TIER_FEATURES } from '@alga-psa/types';

describe('email setup through Integrations settings', () => {
  it('keeps the settings route accessible for email app setup', () => {
    expect(getSettingsTab('integrations')).toBeDefined();
    expect(getSettingsTab('integrations')?.requiredFeature).toBeUndefined();
  });
  it('uses Pro for paid integration upgrade notices', () => {
    expect(FEATURE_MINIMUM_TIER[TIER_FEATURES.INTEGRATIONS]).toBe('pro');
  });
});
