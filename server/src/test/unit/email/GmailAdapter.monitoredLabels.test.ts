import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const historyListMock = vi.fn();
const messageGetMock = vi.fn();
const messageListMock = vi.fn();
const labelsListMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        history: { list: historyListMock },
        messages: { get: messageGetMock, list: messageListMock },
        labels: { list: labelsListMock },
      },
    })),
  },
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    throw new Error('DB must not be touched when label_filters is on the config');
  }),
}));

function buildAdapter(labelFilters: string[] | undefined): GmailAdapter {
  const config: EmailProviderConfig = {
    id: 'provider-id',
    tenant: 'tenant-id',
    name: 'Shared inbox',
    provider_type: 'google',
    mailbox: 'support@example.com',
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
      history_id: '100',
      label_filters: labelFilters,
    },
  };
  const adapter = new GmailAdapter(config);
  (adapter as any).accessToken = 'ya29.test-token';
  (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  return adapter;
}

const historyWith = (...ids: string[]) => ({
  data: {
    historyId: '200',
    history: ids.map((id, i) => ({ id: String(101 + i), messagesAdded: [{ message: { id } }] })),
  },
});

const messageLabels: Record<string, string[]> = {
  'msg-support': ['INBOX', 'Label_42'],
  'msg-personal': ['INBOX'],
  'msg-archived-support': ['Label_42'],
  'msg-other-label': ['Label_7'],
};

describe('GmailAdapter monitored-label filtering', () => {
  beforeEach(() => {
    historyListMock.mockReset();
    messageGetMock.mockReset();
    messageListMock.mockReset();
    labelsListMock.mockReset();
    labelsListMock.mockResolvedValue({
      data: {
        labels: [
          { id: 'INBOX', name: 'INBOX' },
          { id: 'Label_42', name: 'Support' },
          { id: 'Label_7', name: 'Newsletters' },
        ],
      },
    });
    messageGetMock.mockImplementation(async ({ id }: { id: string }) => {
      if (!(id in messageLabels)) {
        throw Object.assign(new Error('Requested entity was not found.'), {
          response: { status: 404, data: { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } } },
        });
      }
      return { data: { id, labelIds: messageLabels[id] } };
    });
  });

  it('keeps the legacy sweep-everything behaviour for the INBOX default', async () => {
    const adapter = buildAdapter(['INBOX']);
    historyListMock.mockResolvedValueOnce(historyWith('msg-support', 'msg-personal', 'msg-other-label'));

    const ids = await adapter.listMessagesSince('100');

    expect(ids).toEqual(['msg-support', 'msg-personal', 'msg-other-label']);
    expect(labelsListMock).not.toHaveBeenCalled();
    expect(messageGetMock).not.toHaveBeenCalled();
  });

  it('keeps only messages carrying a monitored user label', async () => {
    const adapter = buildAdapter(['Support']);
    historyListMock.mockResolvedValueOnce(
      historyWith('msg-support', 'msg-personal', 'msg-archived-support', 'msg-other-label')
    );

    const ids = await adapter.listMessagesSince('100');

    expect(ids).toEqual(['msg-support', 'msg-archived-support']);
    expect(messageGetMock).toHaveBeenCalledTimes(4);
    for (const call of messageGetMock.mock.calls) {
      expect(call[0]).toMatchObject({ userId: 'me', format: 'minimal' });
    }
  });

  it('honours INBOX alongside a user label when both are configured', async () => {
    const adapter = buildAdapter(['INBOX', 'Support']);
    historyListMock.mockResolvedValueOnce(historyWith('msg-personal', 'msg-other-label', 'msg-archived-support'));

    const ids = await adapter.listMessagesSince('100');

    expect(ids).toEqual(['msg-personal', 'msg-archived-support']);
  });

  it('ingests nothing when the configured label does not exist in the mailbox', async () => {
    const adapter = buildAdapter(['Tickets']);
    historyListMock.mockResolvedValueOnce(historyWith('msg-support', 'msg-personal'));

    const ids = await adapter.listMessagesSince('100');

    expect(ids).toEqual([]);
    expect(messageGetMock).not.toHaveBeenCalled();
  });

  it('drops messages deleted before the check without treating the 404 as a lost history cursor', async () => {
    const adapter = buildAdapter(['Support']);
    const registerSpy = vi.spyOn(adapter, 'registerWebhookSubscription').mockResolvedValue();
    historyListMock.mockResolvedValueOnce(historyWith('msg-support', 'msg-gone'));

    const ids = await adapter.listMessagesSince('100');

    expect(ids).toEqual(['msg-support']);
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('applies the same filter to the time-window reconcile path', async () => {
    const adapter = buildAdapter(['Support']);
    messageListMock.mockResolvedValueOnce({
      data: { messages: [{ id: 'msg-personal' }, { id: 'msg-support' }] },
    });

    const ids = await adapter.listMessageIdsSinceTime(new Date(Date.now() - 3600_000));

    expect(ids).toEqual(['msg-support']);
  });
});
