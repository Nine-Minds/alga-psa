import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../../../../..');
const MAILBOX_PATH_FILES = [
  'packages/integrations/src/services/email/providers/GmailAdapter.ts',
  'server/src/services/email/providers/GmailAdapter.ts',
  'shared/services/email/providers/GmailAdapter.ts',
  'shared/services/email/providers/googleMailboxOAuthClient.ts',
  'packages/integrations/src/actions/email-actions/oauthActions.ts',
  'server/src/app/api/email/oauth/initiate/route.ts',
  'server/src/app/api/auth/google/callback/route.ts',
];

describe('Gmail mailbox paths never read Alga env Google client (F003)', () => {
  for (const rel of MAILBOX_PATH_FILES) {
    it(`${rel} has no process.env.GOOGLE_CLIENT_ID/SECRET read`, () => {
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      expect(src).not.toMatch(/process\.env\.GOOGLE_CLIENT_(ID|SECRET)/);
    });
  }

  it('every GmailAdapter copy resolves credentials through the shared resolver', () => {
    for (const rel of MAILBOX_PATH_FILES.filter((f) => f.endsWith('GmailAdapter.ts'))) {
      expect(fs.readFileSync(path.join(root, rel), 'utf8')).toContain('resolveGoogleMailboxOAuthClient');
    }
  });

  it('EmailProviderAutoWiring (env-first) is gone', () => {
    expect(fs.existsSync(path.join(root, 'server/src/services/email/EmailProviderAutoWiring.ts'))).toBe(false);
  });
});
