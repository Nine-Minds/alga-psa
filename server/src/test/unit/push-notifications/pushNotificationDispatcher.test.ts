import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the module under test
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const mockGetActiveTokens = vi.fn();
const mockSendPush = vi.fn();

vi.mock('../../../lib/pushNotifications/pushTokenService', () => ({
  getActivePushTokensForUser: (...args: unknown[]) => mockGetActiveTokens(...args),
}));

vi.mock('../../../lib/pushNotifications/expoPushService', () => ({
  buildTicketPushMessage: (params: { expoPushToken: string; title: string; body: string; ticketId: string; tenant: string }) => ({
    to: params.expoPushToken,
    title: params.title,
    body: params.body,
    data: { ticketId: params.ticketId },
  }),
  sendPushNotifications: (...args: unknown[]) => mockSendPush(...args),
}));

import { triggerPushForNotification } from '../../../lib/pushNotifications/pushNotificationDispatcher';

describe('pushNotificationDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseNotification = {
    tenant: '00000000-0000-0000-0000-000000000001',
    user_id: '00000000-0000-0000-0000-000000000002',
    template_name: 'ticket-assigned',
    title: 'Ticket Assigned',
    message: 'Ticket #42 assigned to you',
    link: 'https://app.example.com/msp/tickets/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    metadata: null,
  };

  it('sends push for ticket-related templates', async () => {
    mockGetActiveTokens.mockResolvedValue([
      { expo_push_token: 'ExponentPushToken[abc]', device_id: 'dev1', platform: 'ios' },
    ]);
    mockSendPush.mockResolvedValue(undefined);

    await triggerPushForNotification(baseNotification);

    expect(mockGetActiveTokens).toHaveBeenCalledWith(
      baseNotification.tenant,
      baseNotification.user_id,
    );
    expect(mockSendPush).toHaveBeenCalledWith(
      [expect.objectContaining({
        to: 'ExponentPushToken[abc]',
        title: 'Ticket Assigned',
        body: 'Ticket #42 assigned to you',
        data: { ticketId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      })],
      baseNotification.tenant,
    );
  });

  it('skips non-ticket templates', async () => {
    await triggerPushForNotification({
      ...baseNotification,
      template_name: 'project-created',
    });

    expect(mockGetActiveTokens).not.toHaveBeenCalled();
    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('skips when no active tokens exist', async () => {
    mockGetActiveTokens.mockResolvedValue([]);

    await triggerPushForNotification(baseNotification);

    expect(mockSendPush).not.toHaveBeenCalled();
  });

  it('sends to multiple devices', async () => {
    mockGetActiveTokens.mockResolvedValue([
      { expo_push_token: 'ExponentPushToken[abc]', device_id: 'dev1', platform: 'ios' },
      { expo_push_token: 'ExponentPushToken[xyz]', device_id: 'dev2', platform: 'android' },
    ]);
    mockSendPush.mockResolvedValue(undefined);

    await triggerPushForNotification(baseNotification);

    expect(mockSendPush).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ to: 'ExponentPushToken[abc]' }),
        expect.objectContaining({ to: 'ExponentPushToken[xyz]' }),
      ]),
      baseNotification.tenant,
    );
  });

  it('extracts ticketId from notification link', async () => {
    mockGetActiveTokens.mockResolvedValue([
      { expo_push_token: 'ExponentPushToken[abc]', device_id: 'dev1', platform: 'ios' },
    ]);
    mockSendPush.mockResolvedValue(undefined);

    await triggerPushForNotification({
      ...baseNotification,
      link: 'https://app.example.com/msp/tickets/11111111-2222-3333-4444-555555555555#comment-xyz',
    });

    expect(mockSendPush).toHaveBeenCalledWith(
      [expect.objectContaining({
        data: { ticketId: '11111111-2222-3333-4444-555555555555' },
      })],
      baseNotification.tenant,
    );
  });

  it('handles missing link gracefully', async () => {
    mockGetActiveTokens.mockResolvedValue([
      { expo_push_token: 'ExponentPushToken[abc]', device_id: 'dev1', platform: 'ios' },
    ]);
    mockSendPush.mockResolvedValue(undefined);

    await triggerPushForNotification({
      ...baseNotification,
      link: null,
    });

    expect(mockSendPush).toHaveBeenCalledWith(
      [expect.objectContaining({
        data: { ticketId: '' },
      })],
      baseNotification.tenant,
    );
  });

  it('handles all supported ticket templates', async () => {
    const templates = [
      'ticket-created', 'ticket-assigned', 'ticket-reassigned',
      'ticket-additional-agent-assigned', 'ticket-additional-agent-added',
      'ticket-comment-added', 'ticket-comment-added-client',
      'ticket-comment-updated', 'ticket-status-changed',
      'ticket-priority-changed', 'ticket-closed', 'ticket-updated',
    ];

    for (const template of templates) {
      vi.clearAllMocks();
      mockGetActiveTokens.mockResolvedValue([
        { expo_push_token: 'ExponentPushToken[t]', device_id: 'd', platform: 'ios' },
      ]);
      mockSendPush.mockResolvedValue(undefined);

      await triggerPushForNotification({ ...baseNotification, template_name: template });

      expect(mockGetActiveTokens).toHaveBeenCalled();
      expect(mockSendPush).toHaveBeenCalled();
    }
  });
});
