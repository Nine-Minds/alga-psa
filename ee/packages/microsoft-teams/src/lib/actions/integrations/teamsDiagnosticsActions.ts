'use server';

import crypto from 'node:crypto';

import { hasPermission } from '@alga-psa/auth/rbac';
import { withAuth } from '@alga-psa/auth/withAuth';
import { createTenantKnex } from '@alga-psa/db';

import {
  resolveTeamsRecipientLink,
} from '../../notifications/teamsNotificationDelivery';
import {
  writeTeamsDeliveryRow,
  type TeamsDeliveryErrorCode,
} from '../../notifications/teamsDeliveryRecorder';
import {
  getLatestTeamsConversationReferenceImpl,
} from '../../teams/bot/teamsConversationReferences';
import {
  isBotConnectorConfigured,
  sendBotActivity,
} from '../../teams/bot/teamsBotConnector';
import type { TeamsBotResponseActivity } from '../../teams/bot/teamsBotHandler';
import { getTeamsAvailability } from '../../teams/teamsAvailability';

type TeamsTestMessageSkipReason =
  | 'addon_inactive'
  | 'integration_inactive'
  | 'capability_disabled'
  | 'bot_not_configured'
  | 'missing_user_linkage'
  | 'missing_conversation_reference'
  | 'bot_activity_skipped';

export type TeamsTestMessageResult =
  | {
      status: 'sent';
      detail: string;
      deliveryId: string | null;
    }
  | {
      status: 'skipped';
      reason: TeamsTestMessageSkipReason;
      detail: string;
      deliveryId: string | null;
    }
  | {
      status: 'failed';
      errorMessage: string;
      detail: string;
      deliveryId: string | null;
    };

interface TeamsIntegrationRow {
  tenant: string;
  install_status: string | null;
  enabled_capabilities: unknown;
}

const TEST_MESSAGE_TEXT = 'Alga PSA Teams test message';
const MISSING_CONVERSATION_REFERENCE_DETAIL =
  'Open the Alga PSA bot in Teams and send it any message first, then retry.';

function isClientPortalUser(user: any): boolean {
  return user?.user_type === 'client';
}

async function assertCanManageTeamsSettings(user: any): Promise<void> {
  if (isClientPortalUser(user) || !(await hasPermission(user as any, 'system_settings', 'update'))) {
    throw new Error('Forbidden');
  }
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeStringArray(values: unknown): string[] {
  let normalizedValues = values;
  if (typeof normalizedValues === 'string') {
    try {
      normalizedValues = JSON.parse(normalizedValues);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(normalizedValues)) {
    return [];
  }

  return normalizedValues
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function getTeamsIntegrationRow(knex: any, tenant: string): Promise<TeamsIntegrationRow | null> {
  const row = await knex('teams_integrations').where({ tenant }).first();
  return row || null;
}

function mapSkipReasonToErrorCode(reason: TeamsTestMessageSkipReason): TeamsDeliveryErrorCode {
  switch (reason) {
    case 'addon_inactive':
      return 'addon_inactive';
    case 'integration_inactive':
      return 'integration_inactive';
    case 'missing_user_linkage':
    case 'missing_conversation_reference':
      return 'user_not_mapped';
    case 'capability_disabled':
    case 'bot_not_configured':
    case 'bot_activity_skipped':
      return 'package_misconfigured';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

async function recordTeamsTestDelivery(params: {
  tenant: string;
  userId: string;
  microsoftUserId?: string | null;
  status: 'skipped' | 'sent' | 'failed';
  reason?: TeamsTestMessageSkipReason | null;
  errorMessage?: string | null;
  retryable?: boolean | null;
  sentAt?: string | null;
}) {
  return writeTeamsDeliveryRow({
    tenant: params.tenant,
    internalNotificationId: null,
    category: 'test',
    destinationType: 'bot_test',
    destinationId: normalizeString(params.microsoftUserId) || normalizeString(params.userId) || 'unknown',
    attemptNumber: 1,
    idempotencyNonce: crypto.randomUUID(),
    status: params.status,
    errorCode: params.reason ? mapSkipReasonToErrorCode(params.reason) : params.status === 'failed' ? 'transient' : null,
    errorMessage: params.errorMessage || params.reason || null,
    retryable: typeof params.retryable === 'boolean' ? params.retryable : params.status === 'failed',
    sentAt: params.sentAt ?? null,
  });
}

function buildTeamsTestActivity(params: {
  tenant: string;
  userId: string;
}): TeamsBotResponseActivity {
  return {
    type: 'message',
    text: TEST_MESSAGE_TEXT,
    inputHint: 'acceptingInput',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.hero',
        content: {
          title: TEST_MESSAGE_TEXT,
          text: 'Teams proactive messaging is configured for this admin account.',
        },
      },
    ],
    metadata: {
      tenantId: params.tenant,
      userId: params.userId,
      commandId: 'teams_test_message',
      conversationType: 'personal',
    },
  };
}

function skippedResult(
  reason: TeamsTestMessageSkipReason,
  detail: string,
  deliveryId: string | null
): TeamsTestMessageResult {
  return {
    status: 'skipped',
    reason,
    detail,
    deliveryId,
  };
}

export async function sendTeamsTestMessageImpl(
  user: unknown,
  { tenant }: { tenant: string },
  _input: Record<string, never> = {}
): Promise<TeamsTestMessageResult> {
  await assertCanManageTeamsSettings(user as any);

  const userId = normalizeString((user as any)?.user_id);
  const availability = await getTeamsAvailability({
    tenantId: tenant,
    userId,
  });

  if (availability.enabled === false) {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      status: 'skipped',
      reason: 'addon_inactive',
      retryable: false,
    });
    return skippedResult('addon_inactive', availability.message, delivery.deliveryId);
  }

  const { knex } = await createTenantKnex(tenant);
  const integration = await getTeamsIntegrationRow(knex, tenant);
  if (!integration || normalizeString(integration.install_status) !== 'active') {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      status: 'skipped',
      reason: 'integration_inactive',
      retryable: false,
    });
    return skippedResult('integration_inactive', 'Activate the Teams integration before sending a test message.', delivery.deliveryId);
  }

  const capabilities = normalizeStringArray(integration.enabled_capabilities);
  if (!capabilities.includes('personal_bot')) {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      status: 'skipped',
      reason: 'capability_disabled',
      retryable: false,
    });
    return skippedResult('capability_disabled', 'Enable the Teams personal bot capability before sending a test message.', delivery.deliveryId);
  }

  if (!isBotConnectorConfigured()) {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      status: 'skipped',
      reason: 'bot_not_configured',
      retryable: false,
    });
    return skippedResult('bot_not_configured', 'Configure TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, and TEAMS_BOT_APP_PASSWORD.', delivery.deliveryId);
  }

  const recipientLink = await resolveTeamsRecipientLink(tenant, userId);
  if (!recipientLink) {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      status: 'skipped',
      reason: 'missing_user_linkage',
      retryable: false,
    });
    return skippedResult('missing_user_linkage', 'Link your Microsoft account before sending a Teams test message.', delivery.deliveryId);
  }

  const conversationReference = await getLatestTeamsConversationReferenceImpl({
    tenant,
    microsoftUserId: recipientLink.providerAccountId,
  });
  if (!conversationReference) {
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      microsoftUserId: recipientLink.providerAccountId,
      status: 'skipped',
      reason: 'missing_conversation_reference',
      retryable: false,
    });
    return skippedResult('missing_conversation_reference', MISSING_CONVERSATION_REFERENCE_DETAIL, delivery.deliveryId);
  }

  const sentAt = new Date().toISOString();
  try {
    const result = await sendBotActivity({
      serviceUrl: conversationReference.serviceUrl,
      conversationId: conversationReference.conversationId,
      activity: buildTeamsTestActivity({ tenant, userId }),
    });

    if (result.status === 'skipped') {
      const delivery = await recordTeamsTestDelivery({
        tenant,
        userId,
        microsoftUserId: recipientLink.providerAccountId,
        status: 'skipped',
        reason: 'bot_activity_skipped',
        errorMessage: result.reason || 'Bot Framework send skipped.',
        retryable: false,
      });
      return skippedResult('bot_activity_skipped', result.reason || 'Bot Framework send skipped.', delivery.deliveryId);
    }

    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      microsoftUserId: recipientLink.providerAccountId,
      status: 'sent',
      retryable: false,
      sentAt,
    });
    return {
      status: 'sent',
      detail: 'Teams test message sent.',
      deliveryId: delivery.deliveryId,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    const delivery = await recordTeamsTestDelivery({
      tenant,
      userId,
      microsoftUserId: recipientLink.providerAccountId,
      status: 'failed',
      errorMessage,
      retryable: true,
      sentAt,
    });

    return {
      status: 'failed',
      errorMessage,
      detail: 'Teams test message failed.',
      deliveryId: delivery.deliveryId,
    };
  }
}

export const sendTeamsTestMessage = withAuth(sendTeamsTestMessageImpl);
