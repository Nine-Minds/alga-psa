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
      url: `alga://ticket/${params.ticketId}`,
      // Payload metadata so the mobile app can render/sort by priority.
      priority: params.priority ?? 'normal',
    },
    // Expo/OS delivery priority is intentionally unchanged (out of scope).
    priority: 'high' as const,
  };
}

export interface PushSendResult {
  to: string;
  status: 'ok' | 'error';
  error?: string | null;
}

export function buildTestPushMessage(expoPushToken: string, serverHost: string): ExpoPushMessage {
  return {
    to: expoPushToken,
    sound: 'default' as const,
    title: 'AlgaPSA test notification',
    body: `Push notifications from ${serverHost} are working.`,
    data: { kind: 'push-test', priority: 'normal' },
    priority: 'high' as const,
  };
}

export async function sendPushNotifications(
  messages: ExpoPushMessage[],
  tenant: string,
): Promise<PushSendResult[]> {
  const results: PushSendResult[] = [];
  const valid = messages.filter((m) => {
    const ok = Expo.isExpoPushToken(m.to as string);
    if (!ok) results.push({ to: String(m.to), status: 'error', error: 'InvalidExpoPushToken' });
    return ok;
  });
  if (valid.length === 0) return results;

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
          results.push({ to: chunk[i].to as string, status: 'error', error: ticket.details?.error ?? ticket.message ?? 'error' });
          if (ticket.details?.error === 'DeviceNotRegistered') {
            invalidTokens.push(chunk[i].to as string);
          }
        } else {
          results.push({ to: chunk[i].to as string, status: 'ok' });
        }
      }
    } catch (err) {
      // Typically the server cannot reach exp.host (egress blocked, proxy,
      // DNS); the message names it so a support bundle shows the cause.
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[ExpoPush] Failed to send chunk', { err, message });
      for (const m of chunk) results.push({ to: m.to as string, status: 'error', error: `ExpoUnreachable: ${message}` });
    }
  }

  if (invalidTokens.length > 0) {
    await deactivateInvalidTokens(tenant, invalidTokens).catch((err) =>
      logger.error('[ExpoPush] Failed to deactivate invalid tokens', { err }),
    );
  }

  return results;
}
