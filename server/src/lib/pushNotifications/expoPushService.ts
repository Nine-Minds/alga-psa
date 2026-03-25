import Expo, { type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import logger from '@alga-psa/core/logger';
import { deactivateInvalidTokens } from './pushTokenService';

const expo = new Expo();

export interface TicketPushParams {
  expoPushToken: string;
  title: string;
  body: string;
  ticketId: string;
  tenant: string;
}

export function buildTicketPushMessage(params: TicketPushParams): ExpoPushMessage {
  return {
    to: params.expoPushToken,
    sound: 'default' as const,
    title: params.title,
    body: params.body,
    data: {
      ticketId: params.ticketId,
      url: `alga://ticket/${params.ticketId}`,
    },
    priority: 'high' as const,
  };
}

export async function sendPushNotifications(
  messages: ExpoPushMessage[],
  tenant: string,
): Promise<void> {
  const valid = messages.filter((m) => Expo.isExpoPushToken(m.to as string));
  if (valid.length === 0) return;

  const chunks = expo.chunkPushNotifications(valid);
  const invalidTokens: string[] = [];

  for (const chunk of chunks) {
    try {
      const tickets: ExpoPushTicket[] = await expo.sendPushNotificationsAsync(chunk);

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
          }
        }
      }
    } catch (err) {
      logger.error('[ExpoPush] Failed to send chunk', { err });
    }
  }

  if (invalidTokens.length > 0) {
    await deactivateInvalidTokens(tenant, invalidTokens).catch((err) =>
      logger.error('[ExpoPush] Failed to deactivate invalid tokens', { err }),
    );
  }
}
