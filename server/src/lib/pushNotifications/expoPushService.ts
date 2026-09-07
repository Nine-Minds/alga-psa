import type { NotificationDeliveryResult } from '@alga-psa/notifications/lib/notificationTransportTypes';
import Expo, { type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import logger from '@alga-psa/core/logger';
import { deactivateInvalidTokens } from './pushTokenService';

const expo = new Expo();

export interface TicketPushParams {
  expoPushToken: string;
  title: string;
  body: string;
  ticketId: string;
  notificationId?: string;
  tenant: string;
  /**
   * Configured in-app notification priority (high|normal|low), carried to the
   * mobile app as payload metadata only (task 29.8.46). This does NOT change
   * Expo/OS delivery priority — that stays 'high' below.
   */
  priority?: 'high' | 'normal' | 'low';
}

export function buildTicketPushMessage(params: TicketPushParams): ExpoPushMessage {
  return {
    to: params.expoPushToken,
    sound: 'default' as const,
    title: params.title,
    body: params.body,
    data: {
      ticketId: params.ticketId,
      ...(params.notificationId ? { notificationId: params.notificationId } : {}),
      url: `alga://ticket/${params.ticketId}`,
      // Payload metadata so the mobile app can render/sort by priority.
      priority: params.priority ?? 'normal',
    },
    // Expo/OS delivery priority is intentionally unchanged (out of scope).
    priority: 'high' as const,
  };
}

export async function sendPushNotifications(
  messages: ExpoPushMessage[],
  tenant: string,
): Promise<NotificationDeliveryResult> {
  const valid = messages.filter((m) => Expo.isExpoPushToken(m.to as string));
  if (valid.length === 0) return { status: 'skipped', reason: 'no_valid_devices' };

  const chunks = expo.chunkPushNotifications(valid);
  const invalidTokens: string[] = [];
  let accepted = 0, retryableFailure = false, permanentFailure = false;

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);
      if (tickets.length !== chunk.length) retryableFailure = true;

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        if (ticket.status === 'error') {
          logger.warn('[ExpoPush] Send error', {
            token: chunk[i].to,
            error: ticket.message,
            details: ticket.details,
          });
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[i].to as string);
          } else if (ticket.details?.error === 'MessageTooBig') {
            permanentFailure = true;
          } else {
            retryableFailure = true;
          }
        } else { accepted++; }
      }
    } catch (err) {
      retryableFailure = true;
      logger.error('[ExpoPush] Failed to send chunk', { err });
    }
  }

  if (invalidTokens.length > 0) {
    await deactivateInvalidTokens(tenant, invalidTokens).catch((err) =>
      logger.error('[ExpoPush] Failed to deactivate invalid tokens', { err }),
    );
  }
  if (retryableFailure) return { status: 'failed', errorCode: 'push_provider_failed', retryable: true };
  if (permanentFailure) return { status: 'failed', errorCode: 'push_message_too_big', retryable: false };
  return accepted ? { status: 'delivered' } : { status: 'skipped', reason: 'no_valid_devices' };
}
