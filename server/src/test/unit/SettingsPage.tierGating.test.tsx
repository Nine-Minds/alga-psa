/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { settingsNavigationSections } from '../../config/menuConfig';

const searchParamsState = { value: new URLSearchParams('tab=integrations') };
const hasFeature = vi.fn();

vi.mock('next/dynamic', () => ({
  default: () => () => null,
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => searchParamsState.value,
}));

vi.mock('@alga-psa/ui/lib/i18n/client', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? _key),
  }),
}));

vi.mock('@alga-psa/ui', () => ({
  UnsavedChangesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@alga-psa/ui/hooks', () => ({
  useFeatureFlag: () => ({ enabled: true }),
}));

vi.mock('@alga-psa/ui/components/tier-gating/FeatureUpgradeNotice', () => ({
  FeatureUpgradeNotice: ({ featureName }: { featureName: string }) => (
    <div>{featureName} upgrade notice</div>
  ),
}));

vi.mock('@/context/TierContext', () => ({
  useTier: () => ({ hasFeature }),
  useTierFeature: () => true,
}));

vi.mock('../../components/settings/general/GeneralSettings', () => ({ default: () => <div>general content</div> }));
vi.mock('../../components/settings/general/UserManagement', () => ({ default: () => <div>users content</div> }));
vi.mock('../../components/settings/general/ClientPortalSettings', () => ({ default: () => <div>client portal content</div> }));
vi.mock('../../components/settings/general/MspLanguageSettings', () => ({ default: () => <div>language content</div> }));
vi.mock('../../components/settings/general/InteractionSettings', () => ({ default: () => <div>interactions content</div> }));
vi.mock('../../components/settings/general/NotificationsTab', () => ({ default: () => <div>notifications content</div> }));
vi.mock('@/components/settings/import-export/ImportExportSettings', () => ({ default: () => <div>import export content</div> }));
vi.mock('@/components/settings/extensions/ExtensionManagement', () => ({ default: () => <div>extensions content</div> }));
vi.mock('../../components/settings/secrets', () => ({ SecretsManagement: () => <div>secrets content</div> }));
vi.mock('@alga-psa/scheduling/components', () => ({ TimeEntrySettings: () => <div>time entry content</div> }));
vi.mock('@alga-psa/billing/components', () => ({ BillingSettings: () => <div>billing content</div> }));
vi.mock('@alga-psa/integrations/components', () => ({
  IntegrationsSettingsPage: () => <div>integrations content</div>,
}));
vi.mock('@alga-psa/projects/components', () => ({ ProjectSettings: () => <div>projects content</div> }));
vi.mock('@alga-psa/integrations/email/settings/entry', () => ({ EmailSettings: () => <div>email content</div> }));

describe('SettingsPage tier gating', () => {
  beforeEach(() => {
    hasFeature.mockReset();
    hasFeature.mockReturnValue(false);
    searchParamsState.value = new URLSearchParams('tab=integrations');
  });

  it('shows FeatureUpgradeNotice for the Integrations tab when Solo is gated', async () => {
    const { default: SettingsPage } = await import('../../components/settings/SettingsPage');
    render(<SettingsPage />);

    expect(screen.getByText('Integrations upgrade notice')).toBeInTheDocument();
  });

  it('shows FeatureUpgradeNotice for the Extensions tab when Solo is gated', async () => {
    searchParamsState.value = new URLSearchParams('tab=extensions');
    const { default: SettingsPage } = await import('../../components/settings/SettingsPage');
    render(<SettingsPage />);

    expect(screen.getByText('Extensions upgrade notice')).toBeInTheDocument();
  });

  it('shows FeatureUpgradeNotice for the Email tab when Solo is gated', async () => {
    searchParamsState.value = new URLSearchParams('tab=email');
    const { default: SettingsPage } = await import('../../components/settings/SettingsPage');
    render(<SettingsPage />);

    expect(screen.getByText('Email upgrade notice')).toBeInTheDocument();
  });

  it('shows normal Integrations content for Pro tenants', async () => {
    hasFeature.mockReturnValue(true);
    const { default: SettingsPage } = await import('../../components/settings/SettingsPage');
    render(<SettingsPage />);

    expect(screen.getByText('integrations content')).toBeInTheDocument();
  });

  it('keeps gated settings tabs visible in the settings navigation config', () => {
    const dataIntegrationItems = settingsNavigationSections.find(
      (section) => section.translationKey === 'settings.sections.dataIntegration'
    )?.items ?? [];
    const communicationItems = settingsNavigationSections.find(
      (section) => section.translationKey === 'settings.sections.communication'
    )?.items ?? [];

    expect(dataIntegrationItems.some((item) => item.name === 'Integrations')).toBe(true);
    expect(dataIntegrationItems.some((item) => item.name === 'Extensions')).toBe(true);
    expect(communicationItems.some((item) => item.name === 'Email')).toBe(true);
  });
});
