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

  it('serves a browser-readable runbook copy referenced by the canonical doc', () => {
    // Meeting setup moved out of Availability Settings onto the Teams integration
    // settings page (Settings -> Integrations -> Microsoft Teams), so the runbook is
    // surfaced from there / the docs rather than an Availability Settings banner.
    const doc = readRepoFile('docs/integrations/teams-meetings-setup.md');
    const publicCopy = readRepoFile('server/public/docs/integrations/teams-meetings-setup.md');

    expect(doc).toContain('Settings -> Integrations -> Microsoft Teams');
    expect(publicCopy).toContain('Canonical source:');
    expect(publicCopy).toContain('docs/integrations/teams-meetings-setup.md');
  });
});
