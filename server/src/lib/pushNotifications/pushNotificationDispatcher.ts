import logger from '@alga-psa/core/logger';
import { getActivePushTokensForUser } from './pushTokenService';
import { buildTicketPushMessage, sendPushNotifications } from './expoPushService';

const TICKET_PUSH_TEMPLATES = new Set([
  'ticket-created',
  'ticket-assigned',
  'ticket-reassigned',
  'ticket-team-assigned',
  'ticket-additional-agent-assigned',
  'ticket-additional-agent-added',
  'ticket-comment-added',
  'ticket-comment-added-client',
  'ticket-comment-updated',
  'ticket-status-changed',
  'ticket-priority-changed',
  'ticket-closed',
  'ticket-updated',
]);

interface InternalNotification {
  tenant: string;
  user_id: string;
  template_name: string;
  title: string;
  message: string;
  link?: string | null;
  metadata?: Record<string, unknown> | null;
}

// Extracts ticket UUID from notification link like "https://domain/msp/tickets/{uuid}"
const TICKET_LINK_RE = /\/msp\/tickets\/([0-9a-f-]{36})/i;

function extractTicketIdFromLink(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  const match = link.match(TICKET_LINK_RE);
  return match?.[1];
}

/**
 * Fire-and-forget push notification for a created internal notification.
 * Only sends for ticket-related templates. Looks up the user's active
 * mobile push tokens and sends via Expo Push Service.
 */
export async function triggerPushForNotification(
  notification: InternalNotification,
): Promise<void> {
  if (!TICKET_PUSH_TEMPLATES.has(notification.template_name)) return;

  const ticketId = extractTicketIdFromLink(notification.link);

  const tokens = await getActivePushTokensForUser(
    notification.tenant,
    notification.user_id,
  );

  if (tokens.length === 0) return;

  const messages = tokens.map((t) =>
    buildTicketPushMessage({
      expoPushToken: t.expo_push_token,
      title: notification.title,
      body: notification.message,
      ticketId: ticketId ?? '',
      tenant: notification.tenant,
    }),
  );

  await sendPushNotifications(messages, notification.tenant);

  logger.info('[PushDispatcher] Sent push notifications', {
    template: notification.template_name,
    userId: notification.user_id,
    tenant: notification.tenant,
    deviceCount: tokens.length,
  });
}
