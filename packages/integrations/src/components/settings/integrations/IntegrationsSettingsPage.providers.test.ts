import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('IntegrationsSettingsPage providers tab', () => {
  it('T061/T062/T063/T064/T065/T066/T067/T068/T069/T070/T077/T078/T079/T080/T095/T096/T101/T102/T105/T106/T107/T108/T361/T362: keeps Teams out of Providers, keeps Microsoft shared there, and routes Teams visibility through Communication copy and the EE-safe wrapper', () => {
    const filePath = path.join(__dirname, 'IntegrationsSettingsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("import { GoogleIntegrationSettings } from './GoogleIntegrationSettings'");
    expect(source).toContain("import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings'");
    expect(source).toContain("import { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings'");
    expect(source).toContain("import { MspSsoLoginDomainsSettings } from './MspSsoLoginDomainsSettings'");
    expect(source).toContain('<GoogleIntegrationSettings />');
    expect(source).toContain('<MicrosoftIntegrationSettings />');
    expect(source).toContain('<MspSsoLoginDomainsSettings />');
    expect(source).not.toContain('<TeamsIntegrationSettings />');
    expect(source).toContain("id: 'communication'");
    expect(source).toContain("id: 'teams'");
    expect(source).toContain('component: TeamsEnterpriseIntegrationSettings');
    expect(source).toContain(
      "Connect inbox and collaboration surfaces for ticket processing, operator workflows, and Microsoft Teams access."
    );
    expect(source).toContain(
      "Configure shared provider credentials used by email, calendar, SSO, and other integrations."
    );
    expect(source).not.toContain('Configure Teams from the Providers tab');
  });

  it('T081/T082/T347/T348/T349/T350/T363/T364: exports the EE-safe Teams settings wrapper instead of any legacy shared Teams card naming', () => {
    const filePath = path.join(__dirname, 'index.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("export { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings'");
    expect(source).not.toContain("export { TeamsIntegrationSettings } from './TeamsIntegrationSettings'");
  });
});
