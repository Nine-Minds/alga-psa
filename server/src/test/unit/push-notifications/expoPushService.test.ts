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
          // Payload metadata only (task 29.8.46): defaults to 'normal' when the
          // caller does not supply the configured priority.
          priority: 'normal',
        },
        priority: 'high',
      });
    });

    it('carries the configured priority as payload metadata (task 29.8.46)', () => {
      const msg = buildTicketPushMessage({
        expoPushToken: 'ExponentPushToken[abc]',
        title: 'Ticket Assigned',
        body: 'You were assigned ticket #42',
        ticketId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tenant: 'tenant-1',
        priority: 'high',
      });

      // The in-app priority rides in data as metadata; Expo/OS delivery priority
      // stays 'high' regardless.
      expect(msg.data.priority).toBe('high');
      expect(msg.priority).toBe('high');

      const low = buildTicketPushMessage({
        expoPushToken: 'ExponentPushToken[abc]',
        title: 'Ticket Assigned',
        body: 'You were assigned ticket #42',
        ticketId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tenant: 'tenant-1',
        priority: 'low',
      });
      expect(low.data.priority).toBe('low');
      expect(low.priority).toBe('high');
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

    it('reports a per-device outcome so the test endpoint can explain failures', async () => {
      mockSendPushNotificationsAsync.mockResolvedValue([
        { status: 'ok', id: 'receipt-1' },
        { status: 'error', message: 'nope', details: { error: 'DeviceNotRegistered' } },
      ]);
      mockDeactivateInvalidTokens.mockResolvedValue(undefined);

      const results = await sendPushNotifications(
        [
          { to: 'ExponentPushToken[good]', title: 'T', body: 'B' },
          { to: 'ExponentPushToken[gone]', title: 'T', body: 'B' },
          { to: 'garbage', title: 'T', body: 'B' },
        ],
        'tenant-1',
      );

      expect(results).toEqual([
        { to: 'garbage', status: 'error', error: 'InvalidExpoPushToken' },
        { to: 'ExponentPushToken[good]', status: 'ok' },
        { to: 'ExponentPushToken[gone]', status: 'error', error: 'DeviceNotRegistered' },
      ]);
    });

    it('names an unreachable Expo service in the outcome', async () => {
      mockSendPushNotificationsAsync.mockRejectedValue(new Error('getaddrinfo ENOTFOUND exp.host'));

      const results = await sendPushNotifications(
        [{ to: 'ExponentPushToken[abc]', title: 'T', body: 'B' }],
        'tenant-1',
      );

      expect(results).toEqual([
        { to: 'ExponentPushToken[abc]', status: 'error', error: 'ExpoUnreachable: getaddrinfo ENOTFOUND exp.host' },
      ]);
    });
  });

  describe('buildTestPushMessage', () => {
    it('addresses the device and names the server it came from', async () => {
      const { buildTestPushMessage } = await import('../../../lib/pushNotifications/expoPushService');
      const msg = buildTestPushMessage('ExponentPushToken[abc]', 'alga.local');
      expect(msg.to).toBe('ExponentPushToken[abc]');
      expect(msg.body).toContain('alga.local');
      expect(msg.data).toEqual({ kind: 'push-test', priority: 'normal' });
    });
  });
});
