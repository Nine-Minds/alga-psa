/**
 * Event-publisher notifier for runtimes that cannot load the
 * @alga-psa/notifications vertical (standalone email-service, Temporal worker).
 * Same hand-off as inboundAuthPauseEventNotifier.ts: publish
 * INBOUND_EMAIL_QUARANTINED; the server subscriber
 * (inboundQuarantineNotificationSubscriber.ts) creates the admin notifications.
 *
 * The quarantine row is already persisted by the time this runs, so a lost
 * event costs at most a notification, never the record.
 */

import {
  registerInboundQuarantineNotifier,
  type InboundQuarantineNotificationParams,
} from './inboundQuarantine';

export async function publishInboundQuarantineEvent(
  params: InboundQuarantineNotificationParams
): Promise<void> {
  const { publishEvent } = await import('@alga-psa/event-bus/publishers');
  await publishEvent({
    eventType: 'INBOUND_EMAIL_QUARANTINED',
    payload: {
      tenantId: params.tenant,
      occurredAt: new Date().toISOString(),
      actorType: 'SYSTEM',
      quarantineId: params.quarantineId,
      providerId: params.providerId,
      mailbox: params.mailbox,
      sender: params.sender,
      subject: params.subject,
      reason: params.reason,
      matchedBy: params.matchedBy,
      ticketId: params.ticketId,
      ticketNumber: params.ticketNumber,
      quarantinedAt: params.quarantinedAt,
    },
  });
}

export function registerInboundQuarantineEventPublisher(): void {
  registerInboundQuarantineNotifier((params) => publishInboundQuarantineEvent(params));
}
