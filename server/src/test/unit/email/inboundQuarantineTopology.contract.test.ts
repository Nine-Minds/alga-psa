import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every runtime that runs processInboundEmailInApp (and so can quarantine a
 * message) must register the quarantine notification hook at startup and run
 * the loud, non-throwing assertion. Persistence itself does not depend on the
 * hook (see shared/services/email/inboundQuarantine.ts) — the hook only
 * notifies admins — but a mis-wired runtime should still be visible at boot.
 *
 * Mirrors inboundAuthPauseNotifierTopology.contract.test.ts.
 */

const repoRoot = path.resolve(__dirname, '../../../../..');
const read = (relativePath: string) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

describe('inbound quarantine notifier deployment topology', () => {
  it('Next server registers the direct notifications implementation', () => {
    const source = read('server/src/lib/initializeApp.ts');
    expect(source).toContain('registerInboundQuarantineNotifications()');
    expect(source).toContain("assertInboundQuarantineNotifierRegistered('server/initializeApp')");
  });

  it('bin consumer registers the direct notifications implementation', () => {
    const source = read('server/src/bin/unifiedInboundEmailQueueConsumer.ts');
    expect(source).toContain('registerInboundQuarantineNotifications()');
    expect(source).toContain("assertInboundQuarantineNotifierRegistered('server/bin/unifiedInboundEmailQueueConsumer')");
  });

  it('email-service container registers the event-publisher notifier', () => {
    const source = read('services/email-service/src/index.ts');
    expect(source).toContain('registerInboundQuarantineEventPublisher()');
    expect(source).toContain("assertInboundQuarantineNotifierRegistered('services/email-service')");
  });

  it('EE Temporal worker bootstrap registers the event-publisher notifier', () => {
    const source = read('ee/temporal-workflows/src/worker.ts');
    expect(source).toContain('registerInboundQuarantineEventPublisher()');
    expect(source).toContain('assertInboundQuarantineNotifierRegistered("ee/temporal-workflows/worker")');
  });

  it('server subscribes to the worker-published event and registers it with the other subscribers', () => {
    const subscriber = read('server/src/lib/eventBus/subscribers/inboundQuarantineNotificationSubscriber.ts');
    expect(subscriber).toContain("'INBOUND_EMAIL_QUARANTINED'");
    expect(subscriber).toContain('notifyInboundQuarantineAdmins');

    const registrations = read('server/src/lib/eventBus/subscribers/index.ts');
    expect(registrations).toContain('registerInboundQuarantineNotificationSubscriber');
    expect(registrations).toContain('unregisterInboundQuarantineNotificationSubscriber');
  });

  it('shared code does not import the notifications vertical', () => {
    for (const file of [
      'shared/services/email/inboundQuarantine.ts',
      'shared/services/email/inboundQuarantineEventNotifier.ts',
      'shared/services/email/inboundQuarantineConstants.ts',
    ]) {
      expect(read(file)).not.toMatch(/from\s+['"]@alga-psa\/notifications/);
    }
  });

  it('persistence is direct: surfaceInboundQuarantine writes the row before consulting any hook', () => {
    const source = read('shared/services/email/inboundQuarantine.ts');
    const surface = source.slice(source.indexOf('export async function surfaceInboundQuarantine'));
    expect(surface.indexOf('recordInboundQuarantine(')).toBeGreaterThan(-1);
    expect(surface.indexOf('recordInboundQuarantine(')).toBeLessThan(surface.indexOf('dispatchInboundQuarantineNotification('));
  });

  it('event schema admits INBOUND_EMAIL_QUARANTINED and rejects an unknown matchedBy', async () => {
    const { EventSchemas } = await import('@alga-psa/event-schemas');
    const schema = EventSchemas.INBOUND_EMAIL_QUARANTINED;
    expect(schema).toBeTruthy();
    const event = {
      id: '33333333-3333-4333-8333-333333333333',
      timestamp: new Date().toISOString(),
      eventType: 'INBOUND_EMAIL_QUARANTINED' as const,
      payload: {
        tenantId: '11111111-1111-4111-8111-111111111111',
        occurredAt: new Date().toISOString(),
        actorType: 'SYSTEM',
        quarantineId: '44444444-4444-4444-8444-444444444444',
        providerId: '22222222-2222-4222-8222-222222222222',
        mailbox: 'support@msp.example',
        sender: 'someone@customer.example',
        subject: 'Re: printer',
        reason: 'unauthorized_thread_header_sender',
        matchedBy: 'thread_headers',
        ticketId: '55555555-5555-4555-8555-555555555555',
        ticketNumber: 'TIC-1042',
        quarantinedAt: new Date().toISOString(),
      },
    };
    expect(() => schema.parse(event)).not.toThrow();
    expect(() => schema.parse({ ...event, payload: { ...event.payload, matchedBy: 'carrier_pigeon' } })).toThrow();
  });
});
