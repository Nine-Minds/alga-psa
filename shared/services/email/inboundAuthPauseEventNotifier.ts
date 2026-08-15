/**
 * Event-publisher notifier for runtimes that cannot load the
 * @alga-psa/notifications vertical (the standalone email-service container and
 * the Temporal worker, whose build graphs deliberately exclude that package's
 * transitive UI dependencies).
 *
 * Registers a notifier into the shared lifecycle hook that publishes
 * INBOUND_EMAIL_PROVIDER_AUTO_PAUSED through the event bus; a server-side
 * subscriber (server/src/lib/eventBus/subscribers/
 * inboundAuthPauseNotificationSubscriber.ts) receives it and creates the admin
 * notifications where the domain graph loads. Mirrors the established
 * MAINTENANCE_JOB_REQUESTED worker→server hand-off. The paused provider row
 * itself (inbound_paused_at + inbound_pause_reason='auth_failure') is the
 * durable fallback evidence if the event is lost.
 *
 * The event-bus import is lazy (same pattern as inboundEmailOutboxDispatcher)
 * so importing this module never couples module initialization to the bus.
 */

import {
  registerInboundAuthPauseNotifier,
  type InboundAuthPauseNotificationParams,
} from './inboundAuthPauseNotifier';

export async function publishInboundAuthPauseEvent(
  params: InboundAuthPauseNotificationParams
): Promise<void> {
  const { publishEvent } = await import('@alga-psa/event-bus/publishers');
  await publishEvent({
    eventType: 'INBOUND_EMAIL_PROVIDER_AUTO_PAUSED',
    payload: {
      tenantId: params.tenant,
      occurredAt: new Date().toISOString(),
      actorType: 'SYSTEM',
      providerId: params.providerId,
      providerName: params.providerName,
      mailbox: params.mailbox,
      providerType: params.providerType,
      authFailureCode: params.authFailureCode,
      pausedAt: params.pausedAt,
    },
  });
}

export function registerInboundAuthPauseEventPublisher(): void {
  registerInboundAuthPauseNotifier((params) => publishInboundAuthPauseEvent(params));
}
