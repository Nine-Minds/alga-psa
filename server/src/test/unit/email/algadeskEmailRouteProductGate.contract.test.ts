import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(__dirname, '../../../../..');

function read(relPath: string): string {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

describe('Algadesk email route product gates', () => {
  it('F283/F284/F285: email webhook, IMAP, and OAuth routes assert product access', () => {
    const oauthInitiate = read('server/src/app/api/email/oauth/initiate/route.ts');
    const imapOauthInitiate = read('server/src/app/api/email/oauth/imap/initiate/route.ts');
    const imapOauthCallback = read('server/src/app/api/email/oauth/imap/callback/route.ts');
    const imapResync = read('server/src/app/api/email/imap/resync/route.ts');
    const imapReconnect = read('server/src/app/api/email/imap/reconnect/route.ts');

    for (const source of [oauthInitiate, imapOauthInitiate, imapOauthCallback, imapResync, imapReconnect]) {
      expect(source).toContain("assertTenantProductAccess");
      expect(source).toContain("capability: 'email_to_ticket'");
    }

    const googleWebhook = read('packages/integrations/src/webhooks/email/handlers/googleWebhookHandler.ts');
    const microsoftWebhook = read('packages/integrations/src/webhooks/email/handlers/microsoftWebhookHandler.ts');
    const imapWebhook = read('packages/integrations/src/webhooks/email/imap.ts');

    for (const source of [googleWebhook, microsoftWebhook, imapWebhook]) {
      expect(source).toContain('assertTenantEmailProductAccess');
      expect(source).toContain("productCode !== 'psa' && productCode !== 'algadesk'");
    }
  });
});
