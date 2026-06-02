import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../../');

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('Teams meetings setup recording permission docs', () => {
  it('T075: documents recording/transcript consent and Exchange-side calendar mailbox scoping', () => {
    for (const relativePath of [
      'docs/integrations/teams-meetings-setup.md',
      'server/public/docs/integrations/teams-meetings-setup.md',
    ]) {
      const source = read(relativePath);

      expect(source).toContain('Calendars.ReadWrite');
      expect(source).toContain('OnlineMeetingRecording.Read.All');
      expect(source).toContain('OnlineMeetingTranscript.Read.All');
      expect(source).toContain('Exchange Application Access Policy');
      expect(source).toContain('Teams Application Access Policy does not scope calendar access');
    }
  });
});
