import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('IntegrationsSettingsPage providers tab', () => {
  it('includes Microsoft, Teams, and Google provider settings cards', () => {
    const filePath = path.join(__dirname, 'IntegrationsSettingsPage.tsx');
    const source = fs.readFileSync(filePath, 'utf8');

    expect(source).toContain("import { GoogleIntegrationSettings } from './GoogleIntegrationSettings'");
    expect(source).toContain("import { MicrosoftIntegrationSettings } from './MicrosoftIntegrationSettings'");
    expect(source).toContain("import { TeamsIntegrationSettings } from './TeamsIntegrationSettings'");
    expect(source).toContain("import { MspSsoLoginDomainsSettings } from './MspSsoLoginDomainsSettings'");
    expect(source).toContain('<GoogleIntegrationSettings />');
    expect(source).toContain('<MicrosoftIntegrationSettings />');
    expect(source).toContain('<TeamsIntegrationSettings />');
    expect(source).toContain('<MspSsoLoginDomainsSettings />');
  });
});
