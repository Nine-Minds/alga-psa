import logger from '@alga-psa/core/logger';
import { getActivePushTokensForUser, meetsPushPriorityThreshold } from './pushTokenService';
import { buildTaskPushMessage, buildTicketPushMessage, sendPushNotifications } from './expoPushService';

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
  // A ticket comment that @mentions the user.
  'user-mentioned-in-comment',
]);

const TASK_PUSH_TEMPLATES = new Set([
  'task-assigned',
  'task-additional-agent-assigned',
  'task-additional-agent-added',
  'task-comment-added',
]);

// Generic @mention template; it pushes only when the mention sits on a project
// task, which the metadata says. Other mention surfaces stay in-app.
const MENTION_TEMPLATE = 'user-mentioned';

interface InternalNotification {
  tenant: string;
  user_id: string;
  template_name: string;
  title: string;
  message: string;
  priority?: 'high' | 'normal' | 'low' | null;
  link?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

type PushTarget =
  | { kind: 'ticket'; ticketId: string }
  | { kind: 'task'; taskId: string };

// Fallback for ticket notifications written before metadata carried the id.
const TICKET_LINK_RE = /\/msp\/tickets\/([0-9a-f-]{36})/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function extractTicketIdFromLink(link: string | null | undefined): string | undefined {
  if (!link) return undefined;
  const match = link.match(TICKET_LINK_RE);
  return match?.[1];
}

/** The row comes back with jsonb parsed; older callers may still hand over the string. */
function parseMetadata(raw: InternalNotification['metadata']): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function metadataId(metadata: Record<string, unknown>, key: string): string | undefined {
  const value = metadata[key];
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : undefined;
}

/**
 * What a notification should open on the phone, or null when it is not a push
 * surface. Ids come from the notification metadata; the ticket link regex is
 * kept only for rows that predate metadata ids.
 */
export function resolvePushTarget(notification: Pick<InternalNotification, 'template_name' | 'link' | 'metadata'>): PushTarget | null {
  const metadata = parseMetadata(notification.metadata);
  const taskId = metadataId(metadata, 'taskId');

  if (TASK_PUSH_TEMPLATES.has(notification.template_name)) {
    return { kind: 'task', taskId: taskId ?? '' };
  }
  if (notification.template_name === MENTION_TEMPLATE) {
    return taskId ? { kind: 'task', taskId } : null;
  }
  if (TICKET_PUSH_TEMPLATES.has(notification.template_name)) {
    const ticketId = metadataId(metadata, 'ticketId') ?? extractTicketIdFromLink(notification.link) ?? '';
    return { kind: 'ticket', ticketId };
  }
  return null;
}

/**
 * Fire-and-forget push notification for a created internal notification.
 * Sends for ticket and project-task templates. Looks up the user's active
 * mobile push tokens and sends via Expo Push Service.
 */
export async function triggerPushForNotification(
  notification: InternalNotification,
): Promise<void> {
  const target = resolvePushTarget(notification);
  if (!target) return;

  const tokens = await getActivePushTokensForUser(
    notification.tenant,
    notification.user_id,
  );

  if (tokens.length === 0) {
    logger.info('[PushDispatcher] No active push tokens for user; skipping', {
      template: notification.template_name,
      userId: notification.user_id,
      tenant: notification.tenant,
    });
    return;
  }

  // Each device chooses the lowest priority it wants pushed (Settings →
  // "Push me for"). Below-threshold notifications still exist in-app.
  const priority = notification.priority ?? 'normal';
  const eligible = tokens.filter((t) => meetsPushPriorityThreshold(priority, t.push_priority_threshold));
  if (eligible.length === 0) {
    logger.info('[PushDispatcher] All devices filtered by priority threshold; skipping', {
      template: notification.template_name,
      userId: notification.user_id,
      tenant: notification.tenant,
      priority,
      deviceCount: tokens.length,
    });
    return;
  }

  const messages = eligible.map((t) =>
    target.kind === 'task'
      ? buildTaskPushMessage({
          expoPushToken: t.expo_push_token,
          title: notification.title,
          body: notification.message,
          taskId: target.taskId,
          tenant: notification.tenant,
          priority,
        })
      : buildTicketPushMessage({
          expoPushToken: t.expo_push_token,
          title: notification.title,
          body: notification.message,
          ticketId: target.ticketId,
          tenant: notification.tenant,
          priority,
        }),
  );

  await sendPushNotifications(messages, notification.tenant);

  logger.info('[PushDispatcher] Sent push notifications', {
    template: notification.template_name,
    target: target.kind,
    userId: notification.user_id,
    tenant: notification.tenant,
    priority,
    deviceCount: eligible.length,
    filteredByThreshold: tokens.length - eligible.length,
  });
}
