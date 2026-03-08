import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('IntegrationsSettingsPage providers tab', () => {
  it('keeps Teams out of Providers and renders the EE-safe Teams wrapper from Communication', () => {
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
  });

  it('exports the EE-safe Teams settings wrapper instead of the legacy shared Teams card from the integrations index', () => {
    const filePath = path.join(__dirname, 'index.ts');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("export { TeamsEnterpriseIntegrationSettings } from './TeamsEnterpriseIntegrationSettings'");
    expect(source).not.toContain("export { TeamsIntegrationSettings } from './TeamsIntegrationSettings'");
  });
});
