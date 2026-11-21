/**
 * Inbound Quarantine Notification Subscriber
 *
 * Handles INBOUND_EMAIL_QUARANTINED events published by worker-side runtimes
 * (email-service container, Temporal worker) after the quarantine row was
 * persisted. Those runtimes cannot import the notifications vertical, so admin
 * notifications are created here — same hand-off as the auth-pause subscriber.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import type { QuarantineReason } from '@alga-psa/shared/services/email/inboundQuarantine';
import { notifyInboundQuarantineAdmins } from '../../../services/email/inboundQuarantineNotificationService';

let isRegistered = false;

export async function registerInboundQuarantineNotificationSubscriber(): Promise<void> {
  if (isRegistered) return;
  await getEventBus().subscribe('INBOUND_EMAIL_QUARANTINED', handleInboundEmailQuarantined);
  isRegistered = true;
  logger.info('[InboundQuarantineNotificationSubscriber] Registered');
}

export async function unregisterInboundQuarantineNotificationSubscriber(): Promise<void> {
  if (!isRegistered) return;
  await getEventBus().unsubscribe('INBOUND_EMAIL_QUARANTINED', handleInboundEmailQuarantined);
  isRegistered = false;
  logger.info('[InboundQuarantineNotificationSubscriber] Unregistered');
}

async function handleInboundEmailQuarantined(event: unknown): Promise<void> {
  const validated = EventSchemas.INBOUND_EMAIL_QUARANTINED.parse(event);
  const p = validated.payload;
  // Best-effort by contract: the durable row already exists; never rethrow.
  try {
    await notifyInboundQuarantineAdmins({
      tenant: p.tenantId,
      quarantineId: p.quarantineId,
      providerId: p.providerId,
      mailbox: p.mailbox,
      sender: p.sender,
      subject: p.subject,
      reason: p.reason as QuarantineReason,
      matchedBy: p.matchedBy,
      ticketId: p.ticketId,
      ticketNumber: p.ticketNumber,
      quarantinedAt: p.quarantinedAt,
    });
  } catch (error) {
    logger.error('[InboundQuarantineNotificationSubscriber] Failed to deliver admin notifications', {
      tenantId: p.tenantId,
      quarantineId: p.quarantineId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
