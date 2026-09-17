/** @vitest-environment jsdom */
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('category=providers'),
}));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@alga-psa/core', () => ({
  get isEnterprise() { return process.env.NEXT_PUBLIC_EDITION === 'enterprise'; },
}));
vi.mock('./useHuduIntegrationEnabled', () => ({ useHuduIntegrationEnabled: () => ({ enabled: false }) }));
vi.mock('./AccountingIntegrationsSetup', () => ({ default: () => null }));
vi.mock('./RmmIntegrationsSetup', () => ({ default: () => null }));
vi.mock('../../email/EmailProviderConfiguration', () => ({
  EmailProviderConfiguration: () => <div>Email configuration</div>,
}));
vi.mock('./ProviderCredentialsWorkbench', () => ({
  ProviderCredentialsWorkbench: ({ canUseTeams, isEnterpriseEdition }: {
    canUseTeams: boolean;
    isEnterpriseEdition: boolean;
  }) => (
    <div data-testid="provider-workbench" data-teams-enabled={canUseTeams} data-enterprise={isEnterpriseEdition}>
      Shared provider credentials
    </div>
  ),
}));
vi.mock('./CalendarEnterpriseIntegrationSettings', () => ({ CalendarEnterpriseIntegrationSettings: () => null }));
// Keep the real EE-safe wrapper and category navigation; only stub the inner panel.
vi.mock('./TeamsIntegrationSettings', () => ({
  TeamsIntegrationSettings: () => <div>Teams configuration</div>,
}));
vi.mock('./telephony/TelephonyEnterpriseIntegrationSettings', () => ({ TelephonyEnterpriseIntegrationSettings: () => null }));
vi.mock('@alga-psa/integrations/entra/components/entry', () => ({ EntraIntegrationSummaryCard: () => null }));

import IntegrationsSettingsPage from './IntegrationsSettingsPage';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  window.history.replaceState({}, '', '/');
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '../../../../../..');
const settingsLocale = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'server/public/locales/en/msp/settings.json'), 'utf8')
);

describe('IntegrationsSettingsPage providers tab', () => {
  it('T061/T062/T063/T064/T065/T066/T067/T068/T069/T070/T077/T078/T079/T080/T095/T096/T101/T102/T105/T106/T107/T108/T361/T362: keeps Teams out of Providers, keeps Microsoft shared there, and routes Teams visibility through Communication copy and the EE-safe wrapper', () => {
    const filePath = path.join(__dirname, 'IntegrationsSettingsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');
    const workbenchSource = fs.readFileSync(path.join(__dirname, 'ProviderCredentialsWorkbench.tsx'), 'utf8');

    expect(source).toContain("import { ProviderCredentialsWorkbench } from './ProviderCredentialsWorkbench'");
    expect(source).toContain("import { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings'");
    // MSP SSO login domains moved to Security → Single Sign-On; the Providers tab now shows a
    // compact top-level action that deep-links there instead of rendering the domain panel inline.
    expect(source).not.toContain("import { MspSsoLoginDomainsSettings } from './MspSsoLoginDomainsSettings'");
    expect(source).not.toContain('<MspSsoLoginDomainsSettings />');
    expect(source).toContain('<ProviderCredentialsWorkbench canUseTeams={isEEAvailable} isEnterpriseEdition={isEEAvailable} />');
    expect(source).not.toContain("t('integrations.items.google.cardTitle')");
    expect(workbenchSource).toContain('id="msp-sso-moved-link"');
    expect(workbenchSource).toContain("router.push('/msp/security-settings?tab=single-sign-on')");
    expect(workbenchSource).toContain('id={`provider-credentials-${option.id}-tab`}');
    expect(workbenchSource).toContain('id="provider-credentials-google-panel"');
    expect(workbenchSource).toContain('id="provider-credentials-microsoft-panel"');
    expect(workbenchSource).toContain('<GoogleIntegrationSettings onStatusChange={setGoogleStatus} />');
    expect(workbenchSource).toContain('<MicrosoftIntegrationSettings canUseTeams={canUseTeams} onStatusChange={setMicrosoftStatus} />');
    expect(source).not.toContain('<TeamsIntegrationSettings />');
    expect(source).toContain("id: 'communication'");
    expect(source).toContain("id: 'teams'");
    expect(source).toContain('...(isEEAvailable ? [{');
    expect(source).toContain('content: <TeamsEnterpriseIntegrationSettings />');
    expect(source).toContain("t('integrations.categories.communication.description')");
    expect(source).toContain("t('integrations.categories.providers.description.ee')");
    expect(source).toContain("t('integrations.categories.providers.description.oss')");
    expect(settingsLocale.integrations.categories.communication.description).toBe(
      'Connect inbox and collaboration surfaces for ticket processing, operator workflows, and Microsoft Teams access.'
    );
    expect(settingsLocale.integrations.categories.providers.description.ee).toBe(
      'Set up Google or Microsoft for staff sign-in, email, calendar, and other integrations.'
    );
    expect(source).not.toContain('Configure Teams from the Providers tab');
  });

  it.each(['enterprise', 'community'])('renders shared providers and gates Teams under Communication in %s edition', (edition) => {
    vi.stubEnv('NEXT_PUBLIC_EDITION', edition);
    render(<IntegrationsSettingsPage />);

    const isEnterprise = edition === 'enterprise';
    expect(screen.getByTestId('provider-workbench')).toBeVisible();
    expect(screen.getByTestId('provider-workbench')).toHaveAttribute('data-teams-enabled', String(isEnterprise));
    expect(screen.getByTestId('provider-workbench')).toHaveAttribute('data-enterprise', String(isEnterprise));
    expect(screen.queryByText('Teams configuration')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'integrations.items.teams.name' })).not.toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('tab', { name: 'integrations.categories.communication.label' }), {
      button: 0, ctrlKey: false,
    });
    expect(screen.getByText('Email configuration')).toBeVisible();
    expect(screen.queryByTestId('provider-workbench')).not.toBeInTheDocument();

    if (isEnterprise) {
      expect(screen.getByText('Teams configuration')).not.toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'integrations.items.teams.name' }));
      expect(screen.getByText('Teams configuration')).toBeVisible();
      expect(screen.getByText('Email configuration')).not.toBeVisible();
    } else {
      expect(screen.queryByRole('button', { name: 'integrations.items.teams.name' })).not.toBeInTheDocument();
      expect(screen.queryByText('Teams configuration')).not.toBeInTheDocument();
    }
  });

  it('T081/T082/T347/T348/T349/T350/T363/T364: exports the EE-safe Teams settings wrapper instead of any legacy shared Teams card naming', () => {
    const filePath = path.join(__dirname, 'index.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("export { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings'");
    // The inner TeamsIntegrationSettings export is intentional (dependency-cycle refactor
    // c43fa0221e); the providers-tab test above guards that Teams never renders there.
    expect(source).toContain("export { TeamsIntegrationSettings } from './TeamsIntegrationSettings'");
  });
});
