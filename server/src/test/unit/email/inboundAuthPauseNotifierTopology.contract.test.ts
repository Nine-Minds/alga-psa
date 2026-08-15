import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every runtime that can perform the atomic auth-failure auto-pause must have
 * an admin-notification notifier registered at startup — a silent pause is the
 * exact failure this feature exists to prevent. This contract test pins the
 * registration wiring across all four deployment topologies:
 *
 *   - Next server process (initializeApp — direct notifications implementation)
 *   - server bin consumer (direct implementation)
 *   - standalone email-service container (event-publisher notifier; the
 *     @alga-psa/notifications vertical is not in its build graph)
 *   - EE Temporal worker (event-publisher notifier; notifications vertical is
 *     stubbed in that build graph)
 *
 * plus the server-side subscriber that turns the worker event back into admin
 * notifications, and the event-bus schema entry that makes it publishable.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('inbound auth-pause notifier deployment topology', () => {
  it('Next server registers the direct notifications implementation', () => {
    const source = read('server/src/lib/initializeApp.ts');
    expect(source).toContain('registerInboundAuthPauseNotifications()');
    expect(source).toContain('assertInboundAuthPauseNotifierRegistered');
  });

  it('bin consumer registers the direct notifications implementation', () => {
    const source = read('server/src/bin/unifiedInboundEmailQueueConsumer.ts');
    expect(source).toContain('registerInboundAuthPauseNotifications()');
    expect(source).toContain("assertInboundAuthPauseNotifierRegistered('server/bin/unifiedInboundEmailQueueConsumer')");
  });

  it('email-service container registers the event-publisher notifier', () => {
    const source = read('services/email-service/src/index.ts');
    expect(source).toContain('registerInboundAuthPauseEventPublisher()');
    expect(source).toContain("assertInboundAuthPauseNotifierRegistered('services/email-service')");
  });

  it('EE Temporal worker bootstrap registers the event-publisher notifier', () => {
    const source = read('ee/temporal-workflows/src/worker.ts');
    expect(source).toContain('registerInboundAuthPauseEventPublisher()');
    expect(source).toContain("assertInboundAuthPauseNotifierRegistered(\"ee/temporal-workflows/worker\")");
  });

  it('server subscribes to the worker-published auto-pause event and is registered with the other subscribers', () => {
    const subscriber = read('server/src/lib/eventBus/subscribers/inboundAuthPauseNotificationSubscriber.ts');
    expect(subscriber).toContain("'INBOUND_EMAIL_PROVIDER_AUTO_PAUSED'");
    expect(subscriber).toContain('notifyInboundAuthPauseAdmins');

    const registrations = read('server/src/lib/eventBus/subscribers/index.ts');
    expect(registrations).toContain('registerInboundAuthPauseNotificationSubscriber');
    expect(registrations).toContain('unregisterInboundAuthPauseNotificationSubscriber');
  });

  it('event schema admits INBOUND_EMAIL_PROVIDER_AUTO_PAUSED with the safe payload shape', async () => {
    const { EventSchemas } = await import('@alga-psa/event-schemas');
    const schema = EventSchemas.INBOUND_EMAIL_PROVIDER_AUTO_PAUSED;
    expect(schema).toBeTruthy();

    const event = {
      id: '33333333-3333-4333-8333-333333333333',
      timestamp: new Date().toISOString(),
      eventType: 'INBOUND_EMAIL_PROVIDER_AUTO_PAUSED' as const,
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
      },
    };
    expect(() => schema.parse(event)).not.toThrow();
    // Unknown provider types must be rejected (no free-form reason strings).
    expect(() =>
      schema.parse({ ...event, payload: { ...event.payload, providerType: 'smtp' } })
    ).toThrow();
  });
});
