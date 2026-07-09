import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
    expect(source).toContain('<ProviderCredentialsWorkbench canUseTeams={canUseTeams} isEnterpriseEdition={isEEAvailable} />');
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
    expect(source).toContain('component: canUseTeams');
    expect(source).toContain('? TeamsEnterpriseIntegrationSettings');
    expect(source).toContain("t('integrations.categories.communication.description')");
    expect(source).toContain("t('integrations.categories.providers.description.ee')");
    expect(source).toContain("t('integrations.categories.providers.description.oss')");
    expect(settingsLocale.integrations.categories.communication.description).toBe(
      'Connect inbox and collaboration surfaces for ticket processing, operator workflows, and Microsoft Teams access.'
    );
    expect(settingsLocale.integrations.categories.providers.description.ee).toBe(
      'Configure shared provider credentials used by email, calendar, MSP SSO, and other integrations.'
    );
    expect(source).not.toContain('Configure Teams from the Providers tab');
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
