import {
  buildNotificationDeliveredPayload,
  buildNotificationFailedPayload,
  buildNotificationReadPayload,
  buildNotificationSentPayload,
} from '@alga-psa/workflow-streams';
import type { EmitterContracts } from '../registryTypes';
import { IDS, NOW } from '../fixtures';

/** Internal (in-app) and Microsoft Teams notification lifecycle. All emitters already used builders. */

const ACTIONS = 'packages/notifications/src/actions/internal-notification-actions/internalNotificationActions.ts';
const BROADCASTER = 'packages/notifications/src/realtime/internalNotificationBroadcaster.ts';
const TEAMS = 'ee/packages/microsoft-teams/src/lib/notifications/teamsNotificationDelivery.ts';

type NotificationEventType = 'NOTIFICATION_SENT' | 'NOTIFICATION_DELIVERED' | 'NOTIFICATION_FAILED' | 'NOTIFICATION_READ';

const system = { actor: { actorType: 'SYSTEM' as const }, correlationId: IDS.notification, occurredAt: NOW };

export const notificationContracts = {
  NOTIFICATION_SENT: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}#createNotificationFromTemplateInternal`,
        ctx: system,
        build: () =>
          buildNotificationSentPayload({
            notificationId: IDS.notification,
            channel: 'in_app',
            recipientId: IDS.assignee,
            sentAt: NOW,
            templateId: 'ticket-assigned',
          }),
      },
      {
        site: `${ACTIONS}#createNotificationFromTemplateInternal`,
        ctx: system,
        build: () =>
          buildNotificationSentPayload({
            notificationId: IDS.notification,
            channel: 'in_app',
            recipientId: IDS.assignee,
            sentAt: NOW,
          }),
      },
      {
        site: `${TEAMS}#deliverTeamsNotificationImpl`,
        ctx: system,
        build: () =>
          buildNotificationSentPayload({
            notificationId: IDS.notification,
            channel: 'teams',
            recipientId: IDS.assignee,
            sentAt: NOW,
            templateId: 'ticket-assigned',
            contextType: 'assignment',
          }),
      },
    ],
  },
  NOTIFICATION_DELIVERED: {
    status: 'covered',
    cases: [
      {
        site: `${BROADCASTER}#broadcastInAppNotification`,
        ctx: system,
        build: () =>
          buildNotificationDeliveredPayload({
            notificationId: IDS.notification,
            channel: 'in_app',
            recipientId: IDS.assignee,
            deliveredAt: NOW,
          }),
      },
      {
        site: `${TEAMS}#deliverTeamsActivityFeedNotification`,
        ctx: system,
        build: () =>
          buildNotificationDeliveredPayload({
            notificationId: IDS.notification,
            channel: 'teams',
            recipientId: IDS.assignee,
            deliveredAt: NOW,
            providerMessageId: '1752667200000',
          }),
      },
    ],
  },
  NOTIFICATION_FAILED: {
    status: 'covered',
    cases: [
      {
        site: `${BROADCASTER}#broadcastInAppNotification`,
        ctx: system,
        build: () =>
          buildNotificationFailedPayload({
            notificationId: IDS.notification,
            channel: 'in_app',
            recipientId: IDS.assignee,
            failedAt: NOW,
            errorCode: 'redis_publish_failed',
            errorMessage: 'Connection is closed.',
            retryable: true,
          }),
      },
      {
        site: `${TEAMS}#deliverTeamsBotDmNotification`,
        ctx: system,
        build: () =>
          buildNotificationFailedPayload({
            notificationId: IDS.notification,
            channel: 'teams',
            recipientId: IDS.assignee,
            failedAt: NOW,
            errorCode: 'teams_delivery_failed',
            errorMessage: 'Teams rejected the activity (403)',
            retryable: false,
          }),
      },
    ],
  },
  NOTIFICATION_READ: {
    status: 'covered',
    cases: [
      {
        site: `${ACTIONS}#markAsReadAction`,
        ctx: { actor: { actorType: 'USER', actorUserId: IDS.assignee }, correlationId: IDS.notification, occurredAt: NOW },
        build: () =>
          buildNotificationReadPayload({
            notificationId: IDS.notification,
            channel: 'in_app',
            recipientId: IDS.assignee,
            readAt: NOW,
          }),
      },
    ],
  },
} satisfies Pick<EmitterContracts, NotificationEventType>;
