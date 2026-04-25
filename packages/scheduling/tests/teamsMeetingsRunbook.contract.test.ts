import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const readRepoFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '..', '..', '..', relativePath), 'utf8');

describe('Teams meetings setup runbook contract', () => {
  it('keeps the canonical runbook in docs/integrations with the required Azure setup guidance', () => {
    const doc = readRepoFile('docs/integrations/teams-meetings-setup.md');

    expect(doc).toContain('# Microsoft Teams Meetings Setup');
    expect(doc).toContain('OnlineMeetings.ReadWrite.All');
    expect(doc).toContain('New-CsApplicationAccessPolicy');
    expect(doc).toContain('Grant-CsApplicationAccessPolicy');
    expect(doc).toContain('Scheduling -> Availability Settings -> Teams Meetings');
  });

  it('links the Availability Settings banner to the browser-served runbook copy', () => {
    const componentSource = readRepoFile('packages/scheduling/src/components/schedule/AvailabilitySettings.tsx');
    const publicCopy = readRepoFile('server/public/docs/integrations/teams-meetings-setup.md');

    expect(componentSource).toContain("window.open('/docs/integrations/teams-meetings-setup.md'");
    expect(publicCopy).toContain('Canonical source:');
    expect(publicCopy).toContain('docs/integrations/teams-meetings-setup.md');
  });
});
