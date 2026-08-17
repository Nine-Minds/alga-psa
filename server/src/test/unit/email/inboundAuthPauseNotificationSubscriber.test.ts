import { describe, expect, it, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';

const subscribeMock = vi.hoisted(() => vi.fn());
const unsubscribeMock = vi.hoisted(() => vi.fn());
const notifyMock = vi.hoisted(() => vi.fn());
const eventBusFactory = vi.hoisted(() => () => ({
  default: {
    getEventBus: () => ({
      subscribe: subscribeMock,
      unsubscribe: unsubscribeMock,
    }),
  },
  getEventBus: () => ({
    subscribe: subscribeMock,
    unsubscribe: unsubscribeMock,
  }),
}));

// The subscriber imports getEventBus via '../index'; mock every specifier
// shape that resolves to the same module so the mock always applies.
vi.mock('@/lib/eventBus', eventBusFactory);
vi.mock('../../../lib/eventBus/index', eventBusFactory);
vi.mock('../../../lib/eventBus', eventBusFactory);

vi.mock('@/services/email/inboundAuthPauseNotificationService', () => ({
  notifyInboundAuthPauseAdmins: (...args: unknown[]) => notifyMock(...args),
}));

import {
  registerInboundAuthPauseNotificationSubscriber,
  unregisterInboundAuthPauseNotificationSubscriber,
} from '@/lib/eventBus/subscribers/inboundAuthPauseNotificationSubscriber';

function autoPausedEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    timestamp: new Date().toISOString(),
    eventType: 'INBOUND_EMAIL_PROVIDER_AUTO_PAUSED',
    payload: {
      tenantId: '11111111-1111-4111-8111-111111111111',
      occurredAt: new Date().toISOString(),
      actorType: 'SYSTEM',
      providerId: '22222222-2222-4222-8222-222222222222',
      providerName: 'Worker Mailbox',
      mailbox: 'worker@example.com',
      providerType: 'google',
      authFailureCode: 'google:invalid_grant:invalid_rapt',
      pausedAt: new Date().toISOString(),
      ...overrides,
    },
  };
}

describe('inboundAuthPauseNotificationSubscriber', () => {
  let handler: (event: unknown) => Promise<void>;

  // The module-level registration guard makes tests order-dependent under
  // sequence.shuffle; normalize state around every test.
  beforeAll(async () => {
    await unregisterInboundAuthPauseNotificationSubscriber().catch(() => undefined);
  });

  afterAll(async () => {
    await unregisterInboundAuthPauseNotificationSubscriber().catch(() => undefined);
  });

  beforeEach(async () => {
    subscribeMock.mockReset();
    unsubscribeMock.mockReset();
    notifyMock.mockReset();
    await unregisterInboundAuthPauseNotificationSubscriber().catch(() => undefined);
    await registerInboundAuthPauseNotificationSubscriber();
    handler = subscribeMock.mock.calls[0][1];
  });

  afterEach(async () => {
    await unregisterInboundAuthPauseNotificationSubscriber().catch(() => undefined);
  });

  it('subscribes to INBOUND_EMAIL_PROVIDER_AUTO_PAUSED (idempotently)', async () => {
    expect(subscribeMock).toHaveBeenCalledTimes(1);
    expect(subscribeMock).toHaveBeenCalledWith(
      'INBOUND_EMAIL_PROVIDER_AUTO_PAUSED',
      expect.any(Function)
    );

    // Re-registration is a no-op (module-level guard).
    await registerInboundAuthPauseNotificationSubscriber();
    expect(subscribeMock).toHaveBeenCalledTimes(1);

    await unregisterInboundAuthPauseNotificationSubscriber();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('delegates valid events to the admin notifier with the safe payload', async () => {
    await handler(autoPausedEvent());

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant: '11111111-1111-4111-8111-111111111111',
        providerId: '22222222-2222-4222-8222-222222222222',
        providerType: 'google',
        authFailureCode: 'google:invalid_grant:invalid_rapt',
      })
    );
  });

  it('contains delivery failures (never rethrows into the consumer group)', async () => {
    notifyMock.mockRejectedValueOnce(new Error('notifications table unavailable'));

    await expect(handler(autoPausedEvent())).resolves.toBeUndefined();
  });

  it('rejects malformed events instead of notifying garbage', async () => {
    await expect(
      handler(autoPausedEvent({ providerType: 'smtp' }))
    ).rejects.toThrow();
    expect(notifyMock).not.toHaveBeenCalled();
  });
});
