import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InternalNotification } from '@alga-psa/notifications';

const hoisted = vi.hoisted(() => ({
  publishMock: vi.fn(async () => 1),
  disconnectMock: vi.fn(async () => undefined),
  publishWorkflowEventMock: vi.fn(async () => undefined),
  deliverTeamsNotificationMock: vi.fn(async () => ({ status: 'delivered', category: 'assignment', providerMessageId: 'graph-request-1' })),
  redisConfigMock: { prefix: 'test:' },
}));

vi.mock('@alga-psa/event-bus', () => ({
  getRedisClient: async () => ({
    publish: hoisted.publishMock,
    disconnect: hoisted.disconnectMock,
  }),
  getRedisConfig: () => hoisted.redisConfigMock,
}));

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishWorkflowEvent: hoisted.publishWorkflowEventMock,
}));

vi.mock('../../../../../packages/notifications/src/realtime/teamsNotificationDelivery', () => ({
  deliverTeamsNotification: hoisted.deliverTeamsNotificationMock,
}));

import { broadcastNotification } from '../../../../../packages/notifications/src/realtime/internalNotificationBroadcaster';

function makeNotification(overrides: Partial<InternalNotification> = {}): InternalNotification {
  return {
    internal_notification_id: 'notification-1',
    tenant: 'tenant-1',
    user_id: 'user-1',
    template_name: 'ticket-assigned',
    language_code: 'en',
    title: 'Ticket #1001 assigned',
    message: 'Critical issue has been assigned to you.',
    type: 'info',
    category: 'tickets',
    link: '/msp/tickets/ticket-1',
    metadata: null,
    is_read: false,
    read_at: null,
    deleted_at: null,
    delivery_status: 'pending',
    delivery_attempts: 0,
    last_delivery_attempt: null,
    delivery_error: null,
    created_at: '2026-03-07T12:00:00.000Z',
    updated_at: '2026-03-07T12:00:00.000Z',
    ...overrides,
  };
}

describe('internalNotificationBroadcaster', () => {
  beforeEach(() => {
    hoisted.publishMock.mockReset().mockResolvedValue(1);
    hoisted.disconnectMock.mockReset().mockResolvedValue(undefined);
    hoisted.publishWorkflowEventMock.mockReset().mockResolvedValue(undefined);
    hoisted.deliverTeamsNotificationMock.mockReset().mockResolvedValue({
      status: 'delivered',
      category: 'assignment',
      providerMessageId: 'graph-request-1',
    });
  });

  it('T281/T282/T290/T299/T300/T421: attempts Teams delivery alongside the existing Redis in-app delivery path', async () => {
    const notification = makeNotification();

    await broadcastNotification(notification);

    expect(hoisted.publishMock).toHaveBeenCalledWith(
      'test:internal-notifications:tenant-1:user-1',
      expect.stringContaining('"type":"notification.created"')
    );
    expect(hoisted.deliverTeamsNotificationMock).toHaveBeenCalledWith(notification);
    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_DELIVERED',
        payload: expect.objectContaining({
          channel: 'in_app',
          recipientId: 'user-1',
        }),
      })
    );
  });

  it('T422: keeps the Teams delivery attempt independent when the Redis in-app channel fails', async () => {
    hoisted.publishMock.mockRejectedValueOnce(new Error('redis offline'));

    await broadcastNotification(makeNotification());

    expect(hoisted.deliverTeamsNotificationMock).toHaveBeenCalledTimes(1);
    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_FAILED',
        payload: expect.objectContaining({
          channel: 'in_app',
          errorCode: 'redis_publish_failed',
        }),
      })
    );
  });

  it('T196/T297/T298/T303/T304/T436/T437: keeps the Redis in-app broadcast path working when Teams EE delivery is unavailable', async () => {
    hoisted.deliverTeamsNotificationMock.mockResolvedValue({
      status: 'skipped',
      reason: 'delivery_unavailable',
    });

    await expect(broadcastNotification(makeNotification())).resolves.toBeUndefined();

    expect(hoisted.publishMock).toHaveBeenCalledWith(
      'test:internal-notifications:tenant-1:user-1',
      expect.stringContaining('"type":"notification.created"')
    );
    expect(hoisted.deliverTeamsNotificationMock).toHaveBeenCalledTimes(1);
    expect(hoisted.publishWorkflowEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'NOTIFICATION_DELIVERED',
        payload: expect.objectContaining({
          channel: 'in_app',
          recipientId: 'user-1',
        }),
      })
    );
  });
});
