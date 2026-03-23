import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { mockDeactivateInvalidTokens, mockSendPushNotificationsAsync } = vi.hoisted(() => ({
  mockDeactivateInvalidTokens: vi.fn(),
  mockSendPushNotificationsAsync: vi.fn(),
}));

vi.mock('../../../lib/pushNotifications/pushTokenService', () => ({
  deactivateInvalidTokens: (...args: unknown[]) => mockDeactivateInvalidTokens(...args),
}));

vi.mock('expo-server-sdk', () => {
  class MockExpo {
    chunkPushNotifications(messages: unknown[]) {
      return [messages];
    }
    sendPushNotificationsAsync(...args: unknown[]) {
      return mockSendPushNotificationsAsync(...args);
    }
    static isExpoPushToken(token: string) {
      return typeof token === 'string' && token.startsWith('ExponentPushToken[');
    }
  }
  return { default: MockExpo, __esModule: true };
});

import { sendPushNotifications, buildTicketPushMessage } from '../../../lib/pushNotifications/expoPushService';

describe('expoPushService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('buildTicketPushMessage', () => {
    it('builds a well-formed push message', () => {
      const msg = buildTicketPushMessage({
        expoPushToken: 'ExponentPushToken[abc]',
        title: 'Ticket Assigned',
        body: 'You were assigned ticket #42',
        ticketId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tenant: 'tenant-1',
      });

      expect(msg).toEqual({
        to: 'ExponentPushToken[abc]',
        sound: 'default',
        title: 'Ticket Assigned',
        body: 'You were assigned ticket #42',
        data: {
          ticketId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
          url: 'alga://ticket/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        },
        priority: 'high',
      });
    });
  });

  describe('sendPushNotifications', () => {
    it('sends messages and handles success', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'receipt-1' },
      ]);

      await sendPushNotifications(
        [{ to: 'ExponentPushToken[abc]', title: 'Test', body: 'Hello' }],
        'tenant-1',
      );

      expect(mockSendPushNotificationsAsync).toHaveBeenCalledTimes(1);
      expect(mockDeactivateInvalidTokens).not.toHaveBeenCalled();
    });

    it('deactivates tokens on DeviceNotRegistered error', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'error', message: 'Device not registered', details: { error: 'DeviceNotRegistered' } },
      ]);
      mockDeactivateInvalidTokens.mockResolvedValue(undefined);

      await sendPushNotifications(
        [{ to: 'ExponentPushToken[expired]', title: 'Test', body: 'Hello' }],
        'tenant-1',
      );

      expect(mockDeactivateInvalidTokens).toHaveBeenCalledWith(
        'tenant-1',
        ['ExponentPushToken[expired]'],
      );
    });

    it('filters out invalid tokens', async () => {
      await sendPushNotifications(
        [{ to: 'not-a-valid-token', title: 'Test', body: 'Hello' }],
        'tenant-1',
      );

      expect(mockSendPushNotificationsAsync).not.toHaveBeenCalled();
    });

    it('handles send errors gracefully', async () => {
      mockSendPushNotificationsAsync.mockRejectedValue(new Error('Network error'));

      // Should not throw
      await sendPushNotifications(
        [{ to: 'ExponentPushToken[abc]', title: 'Test', body: 'Hello' }],
        'tenant-1',
      );
    });
  });
});
