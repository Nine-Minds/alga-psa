import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '../../../services/email/providers/GmailAdapter';
import { GmailAdapter as SharedGmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const messageGetMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: { history: { list: vi.fn() }, messages: { get: messageGetMock } },
    })),
  },
}));

const providerConfig: EmailProviderConfig = {
  id: 'provider-id',
  tenant: 'tenant-id',
  name: 'Test Gmail Provider',
  provider_type: 'google',
  mailbox: 'user@example.com',
  folder_to_monitor: 'INBOX',
  active: true,
  webhook_notification_url: 'https://app.example.com/api/email/webhooks/google',
  connection_status: 'connected',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  provider_config: {
    access_token: 'ya29.test-token',
    refresh_token: '1//test-refresh',
    token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    history_id: '1',
  },
};

describe('GmailAdapter.getMessageDetails reply identity', () => {
  beforeEach(() => messageGetMock.mockReset());

  it.each([
    ['server adapter', GmailAdapter],
    ['shared adapter', SharedGmailAdapter],
  ])('carries inReplyTo, references and threadId from the %s', async (_label, Adapter) => {
    const adapter = new Adapter(providerConfig);
    messageGetMock.mockResolvedValueOnce({
      data: {
        id: 'gmail-msg-2',
        threadId: 'gmail-thread-9',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'To', value: 'support@example.com' },
            { name: 'Subject', value: 'Re: [Ticket #1]' },
            { name: 'In-Reply-To', value: '<parent@example.com>' },
            { name: 'References', value: '<root@example.com>\r\n\t<parent@example.com>   <x@example.com>' },
            { name: 'x-resolved-original-sender', value: 'victim@example.com' },
            { name: 'X-List-Address', value: 'support@lists.example.com' },
          ],
        },
      },
    });

    const details = await adapter.getMessageDetails('gmail-msg-2');

    expect(details.inReplyTo).toBe('<parent@example.com>');
    expect(details.references).toEqual(['<root@example.com>', '<parent@example.com>', '<x@example.com>']);
    expect(details.threadId).toBe('gmail-thread-9');
    expect(messageGetMock).toHaveBeenCalledTimes(1);
    expect(details.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(details.headers).not.toHaveProperty('X-List-Address');
  });

  it('still carries the Gmail threadId when there are no reply headers', async () => {
    const adapter = new SharedGmailAdapter(providerConfig);
    messageGetMock.mockResolvedValueOnce({
      data: {
        id: 'gmail-msg-1',
        threadId: 'gmail-thread-9',
        labelIds: ['INBOX'],
        payload: { headers: [{ name: 'From', value: 'a@example.com' }] },
      },
    });
    const details = await adapter.getMessageDetails('gmail-msg-1');
    expect(details.threadId).toBe('gmail-thread-9');
    expect(details.inReplyTo).toBeUndefined();
    expect(details.references).toBeUndefined();
  });
});
