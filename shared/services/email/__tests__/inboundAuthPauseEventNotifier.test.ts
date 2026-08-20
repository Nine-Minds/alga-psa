import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearInboundAuthPauseNotifier,
  dispatchInboundAuthPauseNotification,
  isInboundAuthPauseNotifierRegistered,
} from '../inboundAuthPauseNotifier';

const publishEventMock = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/event-bus/publishers', () => ({
  publishEvent: (...args: unknown[]) => publishEventMock(...args),
}));

const {
  registerInboundAuthPauseEventPublisher,
  publishInboundAuthPauseEvent,
} = await import('../inboundAuthPauseEventNotifier');

const params = {
  tenant: '11111111-1111-4111-8111-111111111111',
  providerId: '22222222-2222-4222-8222-222222222222',
  providerName: 'Worker Mailbox',
  mailbox: 'worker@example.com',
  providerType: 'microsoft' as const,
  authFailureCode: 'microsoft:invalid_grant',
  pausedAt: '2026-08-15T12:00:00.000Z',
};

describe('inboundAuthPauseEventNotifier', () => {
  afterEach(() => {
    clearInboundAuthPauseNotifier();
    publishEventMock.mockReset();
  });

  it('registers a notifier that publishes INBOUND_EMAIL_PROVIDER_AUTO_PAUSED', async () => {
    expect(isInboundAuthPauseNotifierRegistered()).toBe(false);

    registerInboundAuthPauseEventPublisher();
    expect(isInboundAuthPauseNotifierRegistered()).toBe(true);

    await dispatchInboundAuthPauseNotification(params);

    expect(publishEventMock).toHaveBeenCalledTimes(1);
    const event = publishEventMock.mock.calls[0][0];
    expect(event.eventType).toBe('INBOUND_EMAIL_PROVIDER_AUTO_PAUSED');
    expect(event.payload).toMatchObject({
      tenantId: params.tenant,
      providerId: params.providerId,
      providerName: params.providerName,
      mailbox: params.mailbox,
      providerType: params.providerType,
      authFailureCode: params.authFailureCode,
      pausedAt: params.pausedAt,
      actorType: 'SYSTEM',
    });
    // No credential material may ride on the event.
    expect(JSON.stringify(event)).not.toMatch(/refresh|secret|token/i);
  });

  it('dispatch failures are contained (never propagate to the pause path)', async () => {
    registerInboundAuthPauseEventPublisher();
    publishEventMock.mockRejectedValueOnce(new Error('bus unavailable'));

    await expect(dispatchInboundAuthPauseNotification(params)).resolves.toBeUndefined();
  });

  it('publishInboundAuthPauseEvent propagates publish errors to its caller', async () => {
    publishEventMock.mockRejectedValueOnce(new Error('bus unavailable'));
    await expect(publishInboundAuthPauseEvent(params)).rejects.toThrow(/bus unavailable/);
  });
});
