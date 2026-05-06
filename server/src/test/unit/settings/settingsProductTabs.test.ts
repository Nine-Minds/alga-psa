import { describe, expect, it } from 'vitest';
import { getAllowedSettingsTabIds } from '@/lib/settingsProductTabs';

describe('settings product tab allowlist', () => {
  it('T006: Algadesk exposes only approved settings tabs', () => {
    const tabs = getAllowedSettingsTabIds('algadesk');
    expect(tabs.has('general')).toBe(true);
    expect(tabs.has('users')).toBe(true);
    expect(tabs.has('teams')).toBe(true);
    expect(tabs.has('ticketing')).toBe(true);
    expect(tabs.has('email')).toBe(true);
    expect(tabs.has('client-portal')).toBe(true);

    expect(tabs.has('billing')).toBe(false);
    expect(tabs.has('sla')).toBe(false);
    expect(tabs.has('projects')).toBe(false);
    expect(tabs.has('time-entry')).toBe(false);
    expect(tabs.has('integrations')).toBe(false);
    expect(tabs.has('extensions')).toBe(false);
    expect(tabs.has('experimental-features')).toBe(false);
  });

  it('PSA mode does not use an allowlist', () => {
    const tabs = getAllowedSettingsTabIds('psa');
    expect(tabs.size).toBe(0);
  });
});
