import { describe, expect, it, vi } from 'vitest';

const dynamicCalls: Array<{ loader: unknown; options: unknown }> = [];

vi.mock('next/dynamic', () => ({
  default: (loader: unknown, options: unknown) => {
    dynamicCalls.push({ loader, options });
    return () => null;
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../../components/settings/general/GeneralSettings', () => ({ default: () => null }));
vi.mock('../../components/settings/general/UserManagement', () => ({ default: () => null }));
vi.mock('../../components/settings/general/ClientPortalSettings', () => ({ default: () => null }));
vi.mock('../../components/settings/general/InteractionSettings', () => ({ default: () => null }));
vi.mock('../../components/settings/general/NotificationsTab', () => ({ default: () => null }));
vi.mock('@/components/settings/import-export/ImportExportSettings', () => ({ default: () => null }));
vi.mock('../../components/settings/secrets', () => ({ SecretsManagement: () => null }));

vi.mock('@alga-psa/scheduling/components', () => ({ TimeEntrySettings: () => null }));
vi.mock('@alga-psa/billing/components', () => ({ BillingSettings: () => null }));
vi.mock('@alga-psa/integrations/components', () => ({ IntegrationsSettingsPage: () => null }));
vi.mock('@alga-psa/projects/components', () => ({ ProjectSettings: () => null }));
vi.mock('@alga-psa/integrations/email/settings/entry', () => ({ EmailSettings: () => null }));

describe('SettingsPage', () => {
  it('loads Experimental Features tab lazily via next/dynamic', async () => {
    await import('../../components/settings/SettingsPage');

    const matchingCall = dynamicCalls.find((call) => {
      if (typeof call.loader !== 'function') return false;
      const source = call.loader.toString();
      return (
        source.includes('ExperimentalFeaturesSettings') &&
        source.includes('general')
      );
    });

    expect(matchingCall).toBeTruthy();
    expect(matchingCall?.options).toEqual(expect.objectContaining({ ssr: false }));
  });
});
