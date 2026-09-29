import { describe, expect, it } from 'vitest';
import * as workspace from './oauthHelpers';
import * as enterprise from '../../../../../ee/packages/calendar/src/lib/utils/calendar/oauthHelpers';
import * as legacyServer from '../../../../../server/src/utils/calendar/oauthHelpers';

const helpers = [
  ['workspace', workspace],
  ['enterprise', enterprise],
  ['server', legacyServer],
] as const;

describe.each(helpers)('%s Microsoft calendar OAuth scopes', (_name, helper) => {
  it('requests mailbox settings permission for Outlook master categories', async () => {
    const authUrl = await helper.generateMicrosoftCalendarAuthUrl({
      clientId: 'client', redirectUri: 'https://example.test/callback', state: 'state',
    });
    const scopes = new URL(authUrl).searchParams.get('scope')?.split(' ') ?? [];
    expect(scopes).toContain('https://graph.microsoft.com/Calendars.ReadWrite');
    expect(scopes).toContain('https://graph.microsoft.com/MailboxSettings.ReadWrite');
    expect(scopes).toContain('offline_access');
  });
});
