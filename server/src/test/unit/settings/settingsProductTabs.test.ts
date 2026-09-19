import { describe, expect, it } from 'vitest';
import { getAllowedSettingsTabIds } from '@/lib/settingsProductTabs';

describe('settings product tab allowlist', () => {
  it('T006: AlgaDesk exposes only approved settings tabs', () => {
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

  it('Co-managed adds operational tabs (sla, notifications, time-entry) without commercial ones', () => {
    const tabs = getAllowedSettingsTabIds('co_managed');
    expect(tabs.has('sla')).toBe(true);
    expect(tabs.has('notifications')).toBe(true);
    // Time periods gate all time entry; the tab holds no rates or invoice config.
    expect(tabs.has('time-entry')).toBe(true);

    expect(tabs.has('billing')).toBe(false);
    expect(tabs.has('integrations')).toBe(false);
    expect(tabs.has('extensions')).toBe(false);
    expect(tabs.has('secrets')).toBe(false);
    expect(tabs.has('import-export')).toBe(false);
  });

  it('PSA mode does not use an allowlist', () => {
    const tabs = getAllowedSettingsTabIds('psa');
    expect(tabs.size).toBe(0);
  });
});
