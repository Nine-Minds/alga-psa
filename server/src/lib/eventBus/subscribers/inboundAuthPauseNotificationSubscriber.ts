/**
 * Inbound Auth-Pause Notification Subscriber
 *
 * Handles INBOUND_EMAIL_PROVIDER_AUTO_PAUSED events published by worker-side
 * runtimes (the email-service container, the Temporal worker) after they
 * performed the atomic auth-failure auto-pause. Those runtimes cannot import
 * the @alga-psa/notifications vertical to deliver admin notifications
 * in-process, so the notification creation happens here on the server, where
 * the domain graph loads — the same worker→server hand-off as
 * MAINTENANCE_JOB_REQUESTED.
 */

import logger from '@alga-psa/core/logger';
import { getEventBus } from '../index';
import { EventSchemas } from '@alga-psa/event-schemas';
import { notifyInboundAuthPauseAdmins } from '../../../services/email/inboundAuthPauseNotificationService';

let isRegistered = false;

export async function registerInboundAuthPauseNotificationSubscriber(): Promise<void> {
  if (isRegistered) {
    return;
  }

  await getEventBus().subscribe('INBOUND_EMAIL_PROVIDER_AUTO_PAUSED', handleInboundEmailProviderAutoPaused);

  isRegistered = true;
  logger.info('[InboundAuthPauseNotificationSubscriber] Registered');
}

export async function unregisterInboundAuthPauseNotificationSubscriber(): Promise<void> {
  if (!isRegistered) {
    return;
  }

  await getEventBus().unsubscribe('INBOUND_EMAIL_PROVIDER_AUTO_PAUSED', handleInboundEmailProviderAutoPaused);

  isRegistered = false;
  logger.info('[InboundAuthPauseNotificationSubscriber] Unregistered');
}

async function handleInboundEmailProviderAutoPaused(event: unknown): Promise<void> {
  const validated = EventSchemas.INBOUND_EMAIL_PROVIDER_AUTO_PAUSED.parse(event);
  const { tenantId, providerId, providerName, mailbox, providerType, authFailureCode, pausedAt } = validated.payload;

  // Best-effort by contract: delivery failures are logged and never rethrown —
  // the persistent settings banner is the durable fallback, and a retry storm
  // around a dead-credential provider must not wedge the consumer group.
  try {
    await notifyInboundAuthPauseAdmins({
      tenant: tenantId,
      providerId,
      providerName,
      mailbox,
      providerType,
      authFailureCode,
      pausedAt,
    });
    logger.info('[InboundAuthPauseNotificationSubscriber] Admin notifications delivered', {
      tenantId,
      providerId,
      authFailureCode,
    });
  } catch (error) {
    logger.error('[InboundAuthPauseNotificationSubscriber] Failed to deliver admin notifications', {
      tenantId,
      providerId,
      authFailureCode,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
