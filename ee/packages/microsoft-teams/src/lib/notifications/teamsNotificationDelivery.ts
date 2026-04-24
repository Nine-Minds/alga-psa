import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex } from '@alga-psa/db';
import { getSSORegistry } from '@alga-psa/auth';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildNotificationDeliveredPayload,
  buildNotificationFailedPayload,
  buildNotificationSentPayload,
} from '@alga-psa/workflow-streams';
import { fetchMicrosoftGraphAppToken } from '../graphAuth';
import { buildTeamsPersonalTabDeepLinkFromPsaUrl } from '../teams/teamsDeepLinks';

type TeamsNotificationCategory =
  | 'assignment'
  | 'customer_reply'
  | 'approval_request'
  | 'escalation'
  | 'sla_risk';

type TeamsActivityType =
  | 'assignmentCreated'
  | 'customerReplyReceived'
  | 'approvalRequested'
  | 'workEscalated'
  | 'slaRiskDetected';

interface TeamsIntegrationRow {
  tenant: string;
  selected_profile_id: string | null;
  install_status: string | null;
  enabled_capabilities: unknown;
  notification_categories: unknown;
  app_id: string | null;
  package_metadata: unknown;
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  client_id: string;
  tenant_id: string;
  client_secret_ref: string;
  is_archived: boolean;
}

interface TeamsPackageMetadata {
  baseUrl?: unknown;
}

interface TeamsRecipientLink {
  providerAccountId: string;
}

interface TeamsNotificationInput {
  internal_notification_id: string;
  tenant: string;
  user_id: string;
  template_name: string | null;
  title: string | null;
  message: string | null;
  link: string | null;
  metadata?: Record<string, unknown> | null;
}

export type TeamsNotificationDeliveryResult =
  | { status: 'skipped'; reason: string }
  | { status: 'delivered'; category: TeamsNotificationCategory; providerMessageId: string | null }
  | { status: 'failed'; category?: TeamsNotificationCategory; errorCode: string; errorMessage: string; retryable: boolean };

const ASSIGNMENT_TEMPLATE_NAMES = new Set([
  'ticket-assigned',
  'task-assigned',
]);

const CUSTOMER_REPLY_TEMPLATE_NAMES = new Set([
  'ticket-comment-added-client',
]);

const SLA_RISK_TEMPLATE_NAMES = new Set([
  'sla-warning',
  'sla-breach',
]);

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || 'Unknown error';
  return String(error || 'Unknown error');
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

function getPackageBaseUrl(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }

  return normalizeString((metadata as TeamsPackageMetadata).baseUrl);
}

function getNotificationSubtype(notification: TeamsNotificationInput): string {
  if (!notification.metadata || typeof notification.metadata !== 'object') {
    return '';
  }

  return normalizeString(notification.metadata.subtype);
}

export function classifyTeamsNotificationCategory(
  notification: TeamsNotificationInput
): TeamsNotificationCategory | null {
  const templateName = normalizeString(notification.template_name);
  const link = normalizeString(notification.link);
  const subtype = getNotificationSubtype(notification);

  if (ASSIGNMENT_TEMPLATE_NAMES.has(templateName)) {
    return 'assignment';
  }

  if (CUSTOMER_REPLY_TEMPLATE_NAMES.has(templateName)) {
    return 'customer_reply';
  }

  if (templateName === 'sla-escalation' || subtype === 'sla-escalation') {
    return 'escalation';
  }

  if (SLA_RISK_TEMPLATE_NAMES.has(templateName)) {
    return 'sla_risk';
  }

  if (templateName.includes('approval') || link.includes('/msp/time-sheet-approvals')) {
    return 'approval_request';
  }

  return null;
}

function mapCategoryToActivityType(category: TeamsNotificationCategory): TeamsActivityType {
  switch (category) {
    case 'assignment':
      return 'assignmentCreated';
    case 'customer_reply':
      return 'customerReplyReceived';
    case 'approval_request':
      return 'approvalRequested';
    case 'escalation':
      return 'workEscalated';
    case 'sla_risk':
      return 'slaRiskDetected';
    default: {
      const exhaustive: never = category;
      throw new Error(`Unsupported Teams notification category: ${exhaustive}`);
    }
  }
}

function buildTemplateParameters(notification: TeamsNotificationInput): Array<{ name: string; value: string }> {
  return [
    {
      name: 'item',
      value: normalizeString(notification.title) || 'PSA work item',
    },
  ];
}

function safePublishNotificationWorkflowEvent(params: Parameters<typeof publishWorkflowEvent>[0]): void {
  void publishWorkflowEvent(params).catch((error) => {
    logger.warn('[TeamsNotificationDelivery] Failed to publish workflow notification event', {
      error: normalizeErrorMessage(error),
      eventType: params.eventType,
    });
  });
}

async function getTeamsIntegrationRow(knex: any, tenant: string): Promise<TeamsIntegrationRow | undefined> {
  const row = await knex('teams_integrations').where({ tenant }).first();
  return row || undefined;
}

async function getMicrosoftProfileRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | undefined> {
  const row = await knex('microsoft_profiles').where({
    tenant,
    profile_id: profileId,
  }).first();
  return row || undefined;
}

async function resolveTeamsRecipientLink(
  tenant: string,
  userId: string
): Promise<TeamsRecipientLink | null> {
  const accountLinks = await getSSORegistry().listOAuthAccountLinksForUser(tenant, userId);
  const microsoftLink = accountLinks.find((link) => link.provider === 'microsoft');

  if (!microsoftLink) {
    return null;
  }

  const providerAccountId = normalizeString(microsoftLink.provider_account_id);
  return providerAccountId ? { providerAccountId } : null;
}

async function fetchMicrosoftGraphAppTokenForProfile(params: {
  tenant: string;
  tenantAuthority: string;
  clientId: string;
  clientSecretRef: string;
}): Promise<string> {
  const secretProvider = await getSecretProviderInstance();
  const clientSecret = await secretProvider.getTenantSecret(params.tenant, params.clientSecretRef);

  if (!clientSecret) {
    throw new Error('Selected Teams Microsoft profile is missing the client secret required for Graph delivery.');
  }

  return fetchMicrosoftGraphAppToken({
    tenantAuthority: params.tenantAuthority,
    clientId: params.clientId,
    clientSecret,
  });
}

export async function deliverTeamsNotificationImpl(
  notification: TeamsNotificationInput
): Promise<TeamsNotificationDeliveryResult> {
  const category = classifyTeamsNotificationCategory(notification);
  if (!category) {
    return { status: 'skipped', reason: 'unsupported_category' };
  }

  const link = normalizeString(notification.link);
  if (!link) {
    return { status: 'skipped', reason: 'missing_link' };
  }

  const { knex } = await createTenantKnex();
  const integration = await getTeamsIntegrationRow(knex, notification.tenant);

  if (!integration || normalizeString(integration.install_status) !== 'active') {
    return { status: 'skipped', reason: 'integration_inactive' };
  }

  const enabledCapabilities = normalizeStringArray(integration.enabled_capabilities);
  if (!enabledCapabilities.includes('activity_notifications')) {
    return { status: 'skipped', reason: 'capability_disabled' };
  }

  const enabledCategories = normalizeStringArray(integration.notification_categories);
  if (!enabledCategories.includes(category)) {
    return { status: 'skipped', reason: 'category_disabled' };
  }

  const selectedProfileId = normalizeString(integration.selected_profile_id);
  const appId = normalizeString(integration.app_id);
  const baseUrl = getPackageBaseUrl(integration.package_metadata);
  if (!selectedProfileId || !appId || !baseUrl) {
    return { status: 'skipped', reason: 'delivery_prerequisites_missing' };
  }

  const profile = await getMicrosoftProfileRow(knex, notification.tenant, selectedProfileId);
  if (!profile || profile.is_archived) {
    return { status: 'skipped', reason: 'invalid_profile' };
  }

  const recipientLink = await resolveTeamsRecipientLink(notification.tenant, notification.user_id);
  if (!recipientLink) {
    return { status: 'skipped', reason: 'missing_user_linkage' };
  }

  const teamsDeepLink = buildTeamsPersonalTabDeepLinkFromPsaUrl(baseUrl, appId, link);
  const now = new Date().toISOString();
  const activityType = mapCategoryToActivityType(category);

  safePublishNotificationWorkflowEvent({
    eventType: 'NOTIFICATION_SENT',
    payload: buildNotificationSentPayload({
      notificationId: notification.internal_notification_id,
      channel: 'teams',
      recipientId: notification.user_id,
      sentAt: now,
      templateId: notification.template_name ?? undefined,
      contextType: category,
    }),
    ctx: {
      tenantId: notification.tenant,
      occurredAt: now,
      actor: { actorType: 'SYSTEM' },
      correlationId: notification.internal_notification_id,
    },
    idempotencyKey: `notification:${notification.internal_notification_id}:teams:sent`,
  });

  try {
    const accessToken = await fetchMicrosoftGraphAppTokenForProfile({
      tenant: notification.tenant,
      tenantAuthority: profile.tenant_id,
      clientId: profile.client_id,
      clientSecretRef: profile.client_secret_ref,
    });

    const response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(recipientLink.providerAccountId)}/teamwork/sendActivityNotification`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          topic: {
            source: 'text',
            value: normalizeString(notification.title) || 'Alga PSA notification',
            webUrl: teamsDeepLink,
          },
          activityType,
          previewText: {
            content: normalizeString(notification.message) || normalizeString(notification.title) || 'Alga PSA notification',
          },
          recipient: {
            '@odata.type': 'microsoft.graph.aadUserNotificationRecipient',
            userId: recipientLink.providerAccountId,
          },
          templateParameters: buildTemplateParameters(notification),
        }),
      }
    );

    if (!response.ok) {
      const errorBody = await response.text();
      const errorMessage = `Teams activity notification delivery failed (${response.status}): ${errorBody || response.statusText}`;

      safePublishNotificationWorkflowEvent({
        eventType: 'NOTIFICATION_FAILED',
        payload: buildNotificationFailedPayload({
          notificationId: notification.internal_notification_id,
          channel: 'teams',
          recipientId: notification.user_id,
          failedAt: new Date().toISOString(),
          errorCode: 'teams_delivery_failed',
          errorMessage,
          retryable: response.status >= 500 || response.status === 429,
        }),
        ctx: {
          tenantId: notification.tenant,
          occurredAt: now,
          actor: { actorType: 'SYSTEM' },
          correlationId: notification.internal_notification_id,
        },
        idempotencyKey: `notification:${notification.internal_notification_id}:teams:failed`,
      });

      return {
        status: 'failed',
        category,
        errorCode: 'teams_delivery_failed',
        errorMessage,
        retryable: response.status >= 500 || response.status === 429,
      };
    }

    const providerMessageId = normalizeString(response.headers.get('request-id')) || null;

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_DELIVERED',
      payload: buildNotificationDeliveredPayload({
        notificationId: notification.internal_notification_id,
        channel: 'teams',
        recipientId: notification.user_id,
        deliveredAt: new Date().toISOString(),
        providerMessageId: providerMessageId || undefined,
      }),
      ctx: {
        tenantId: notification.tenant,
        occurredAt: now,
        actor: { actorType: 'SYSTEM' },
        correlationId: notification.internal_notification_id,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:teams:delivered`,
    });

    return {
      status: 'delivered',
      category,
      providerMessageId,
    };
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);

    safePublishNotificationWorkflowEvent({
      eventType: 'NOTIFICATION_FAILED',
      payload: buildNotificationFailedPayload({
        notificationId: notification.internal_notification_id,
        channel: 'teams',
        recipientId: notification.user_id,
        failedAt: new Date().toISOString(),
        errorCode: 'teams_delivery_exception',
        errorMessage,
        retryable: true,
      }),
      ctx: {
        tenantId: notification.tenant,
        occurredAt: now,
        actor: { actorType: 'SYSTEM' },
        correlationId: notification.internal_notification_id,
      },
      idempotencyKey: `notification:${notification.internal_notification_id}:teams:failed`,
    });

    logger.warn('[TeamsNotificationDelivery] Failed to deliver Teams activity notification', {
      notificationId: notification.internal_notification_id,
      tenant: notification.tenant,
      userId: notification.user_id,
      category,
      error: errorMessage,
    });

    return {
      status: 'failed',
      category,
      errorCode: 'teams_delivery_exception',
      errorMessage,
      retryable: true,
    };
  }
}
