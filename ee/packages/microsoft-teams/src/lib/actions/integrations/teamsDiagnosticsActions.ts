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
  selected_profile_id?: string | null;
  install_status: string | null;
  enabled_capabilities: unknown;
  app_id?: string | null;
  package_metadata?: unknown;
  default_meeting_organizer_upn?: string | null;
  default_meeting_organizer_object_id?: string | null;
}

interface MicrosoftProfileRow {
  tenant: string;
  profile_id: string;
  client_id: string | null;
  tenant_id: string | null;
  client_secret_ref: string | null;
  is_archived: boolean | null;
}

const TEST_MESSAGE_TEXT = 'Alga PSA Teams test message';
const MISSING_CONVERSATION_REFERENCE_DETAIL =
  'Open the Alga PSA bot in Teams and send it any message first, then retry.';
const LINK_MICROSOFT_ACCOUNT_RECOMMENDATION = 'Link your Microsoft account in your profile settings.';
const MESSAGE_BOT_RECOMMENDATION = 'Open the Alga PSA bot in Teams and send it any message first, then retry.';
const BOT_ENV_RECOMMENDATION = 'Configure TEAMS_BOT_APP_ID, TEAMS_BOT_APP_TENANT_ID, and TEAMS_BOT_APP_PASSWORD.';
const ACTIVATE_INTEGRATION_RECOMMENDATION = 'Activate the Teams integration in settings.';

export type TeamsDiagnosticsStatus = 'pass' | 'warn' | 'fail' | 'skip';

export interface TeamsDiagnosticsStep {
  id: string;
  title: string;
  status: TeamsDiagnosticsStatus;
  detail: string;
  durationMs: number;
  data?: Record<string, unknown>;
  error?: string;
}

export interface TeamsDiagnosticsReport {
  createdAt: string;
  overallStatus: Exclude<TeamsDiagnosticsStatus, 'skip'>;
  steps: TeamsDiagnosticsStep[];
  recommendations: string[];
}

interface StepOutcome {
  status: TeamsDiagnosticsStatus;
  detail: string;
  data?: Record<string, unknown>;
  error?: string;
  recommendations?: string[];
}

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

async function getMicrosoftProfileRow(
  knex: any,
  tenant: string,
  profileId: string
): Promise<MicrosoftProfileRow | null> {
  const row = await knex('microsoft_profiles').where({ tenant, profile_id: profileId }).first();
  return row || null;
}

function getPackageBaseUrl(metadata: unknown): string {
  if (!metadata || typeof metadata !== 'object') {
    return '';
  }
  return normalizeString((metadata as { baseUrl?: unknown }).baseUrl);
}

function isResolvableBaseUrl(value: string): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function serializeDate(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return normalizeString(value) || null;
}

function mapDeliveryRow(row: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!row) {
    return null;
  }
  return {
    deliveryId: row.delivery_id ?? null,
    status: row.status ?? null,
    category: row.category ?? null,
    destinationType: row.destination_type ?? null,
    destinationId: row.destination_id ?? null,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    createdAt: serializeDate(row.created_at),
    sentAt: serializeDate(row.sent_at),
    deliveredAt: serializeDate(row.delivered_at),
  };
}

async function getLatestDelivery(knex: any, tenant: string, statuses?: string[]): Promise<Record<string, unknown> | null> {
  const query = knex('teams_notification_deliveries')
    .where({ tenant })
    .modify((builder: any) => {
      if (statuses && statuses.length > 0) {
        builder.whereIn('status', statuses);
      }
    })
    .orderBy('created_at', 'desc')
    .orderBy('delivery_id', 'desc');

  const row = await query.first([
    'delivery_id',
    'status',
    'category',
    'destination_type',
    'destination_id',
    'error_code',
    'error_message',
    'created_at',
    'sent_at',
    'delivered_at',
  ]);
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

export async function runTeamsDiagnosticsImpl(
  user: unknown,
  { tenant }: { tenant: string },
  _input: Record<string, never> = {}
): Promise<TeamsDiagnosticsReport> {
  await assertCanManageTeamsSettings(user as any);

  const userId = normalizeString((user as any)?.user_id);
  const steps: TeamsDiagnosticsStep[] = [];
  const recommendations = new Set<string>();
  let integration: TeamsIntegrationRow | null = null;
  let microsoftUserId: string | null = null;
  let conversationReferenceFound = false;
  const { knex } = await createTenantKnex(tenant);

  async function runStep(id: string, title: string, fn: () => Promise<StepOutcome>): Promise<void> {
    const startedAt = Date.now();
    try {
      const outcome = await fn();
      for (const recommendation of outcome.recommendations || []) {
        if (recommendation) recommendations.add(recommendation);
      }
      steps.push({
        id,
        title,
        status: outcome.status,
        detail: outcome.detail,
        durationMs: Math.max(0, Date.now() - startedAt),
        ...(outcome.data ? { data: outcome.data } : {}),
        ...(outcome.error ? { error: outcome.error } : {}),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
      steps.push({
        id,
        title,
        status: 'fail',
        detail: errorMessage,
        durationMs: Math.max(0, Date.now() - startedAt),
        error: errorMessage,
      });
    }
  }

  await runStep('addon_entitlement', 'Teams add-on entitlement', async () => {
    const availability = await getTeamsAvailability({ tenantId: tenant, userId });
    if (availability.enabled === false) {
      return {
        status: 'fail',
        detail: availability.message,
        data: { reason: availability.reason },
        recommendations: ['Enable the Microsoft Teams add-on for this tenant.'],
      };
    }
    return { status: 'pass', detail: 'Teams add-on is active.' };
  });

  await runStep('integration_status', 'Teams integration status', async () => {
    integration = await getTeamsIntegrationRow(knex, tenant);
    if (!integration) {
      return {
        status: 'fail',
        detail: 'Teams integration settings have not been saved.',
        recommendations: [ACTIVATE_INTEGRATION_RECOMMENDATION],
      };
    }
    if (normalizeString(integration.install_status) !== 'active') {
      return {
        status: 'warn',
        detail: `Teams integration is ${normalizeString(integration.install_status) || 'not_configured'}.`,
        data: { installStatus: integration.install_status },
        recommendations: [ACTIVATE_INTEGRATION_RECOMMENDATION],
      };
    }
    return {
      status: 'pass',
      detail: 'Teams integration is active.',
      data: { installStatus: integration.install_status },
    };
  });

  await runStep('capabilities', 'Teams capabilities', async () => {
    if (!integration) {
      return { status: 'skip', detail: 'Teams integration settings are required before capabilities can be checked.' };
    }
    const capabilities = normalizeStringArray(integration.enabled_capabilities);
    const missing = ['personal_bot', 'activity_notifications'].filter((capability) => !capabilities.includes(capability));
    if (missing.length > 0) {
      return {
        status: 'warn',
        detail: `Missing required capabilities: ${missing.join(', ')}.`,
        data: { enabledCapabilities: capabilities, missingCapabilities: missing },
        recommendations: ['Enable personal bot and activity notifications for Teams.'],
      };
    }
    return {
      status: 'pass',
      detail: 'Personal bot and activity notifications are enabled.',
      data: { enabledCapabilities: capabilities },
    };
  });

  await runStep('microsoft_profile', 'Microsoft profile readiness', async () => {
    if (!integration) {
      return { status: 'skip', detail: 'Teams integration settings are required before profile readiness can be checked.' };
    }
    const selectedProfileId = normalizeString(integration.selected_profile_id);
    if (!selectedProfileId) {
      return {
        status: 'fail',
        detail: 'No Microsoft profile is selected for Teams.',
        recommendations: ['Select a ready Microsoft profile for Teams.'],
      };
    }
    const profile = await getMicrosoftProfileRow(knex, tenant, selectedProfileId);
    if (!profile) {
      return {
        status: 'fail',
        detail: 'Selected Microsoft profile was not found.',
        data: { selectedProfileId },
        recommendations: ['Select a ready Microsoft profile for Teams.'],
      };
    }
    if (profile.is_archived) {
      return {
        status: 'fail',
        detail: 'Selected Microsoft profile is archived.',
        data: { selectedProfileId },
        recommendations: ['Select an active Microsoft profile for Teams.'],
      };
    }
    if (!normalizeString(profile.client_secret_ref)) {
      return {
        status: 'fail',
        detail: 'Selected Microsoft profile is missing a client secret reference.',
        data: { selectedProfileId },
        recommendations: ['Complete Microsoft profile credentials before activating Teams.'],
      };
    }
    return {
      status: 'pass',
      detail: 'Selected Microsoft profile is ready.',
      data: { selectedProfileId },
    };
  });

  await runStep('recording_permissions', 'Teams recording and transcript permissions', async () => {
    if (!integration) {
      return { status: 'skip', detail: 'Teams integration settings are required before recording permissions can be checked.' };
    }

    const organizerUpn = normalizeString(integration.default_meeting_organizer_upn);
    const organizerObjectId = normalizeString(integration.default_meeting_organizer_object_id);
    if (!organizerUpn) {
      return {
        status: 'warn',
        detail: 'No Teams meeting organizer is configured, so recording and transcript capture cannot run.',
        data: { recordingsAvailable: false, reason: 'no_organizer' },
        recommendations: ['Configure the default Teams meeting organizer in Teams settings.'],
      };
    }

    if (!organizerObjectId) {
      return {
        status: 'warn',
        detail: 'The Teams meeting organizer object id is missing. Save the organizer in Teams settings so recording and transcript capture can address Graph by object id.',
        data: { recordingsAvailable: false, reason: 'missing_organizer_object_id', organizerUpn },
        recommendations: ['Save the default Teams meeting organizer again so Alga PSA can resolve its Microsoft Entra object id.'],
      };
    }

    return {
      status: 'pass',
      detail: 'Recording capture prerequisites are configured in Alga PSA. Confirm Microsoft Graph recording/transcript admin consent and Exchange mailbox scoping in Microsoft 365.',
      data: {
        recordingsAvailable: true,
        organizerUpn,
        organizerObjectId,
        requiredGraphApplicationPermissions: [
          'Calendars.ReadWrite',
          'OnlineMeetingRecording.Read.All',
          'OnlineMeetingTranscript.Read.All',
        ],
        exchangeMailboxScopingRequired: true,
      },
    };
  });

  await runStep('package_metadata', 'Teams package metadata', async () => {
    if (!integration) {
      return { status: 'skip', detail: 'Teams integration settings are required before package metadata can be checked.' };
    }
    const appId = normalizeString(integration.app_id);
    const baseUrl = getPackageBaseUrl(integration.package_metadata);
    if (!appId || !integration.package_metadata) {
      return {
        status: 'fail',
        detail: 'Teams app package has not been generated.',
        data: { appId: appId || null, baseUrl: baseUrl || null },
        recommendations: ['Generate the Teams app package before running end-to-end validation.'],
      };
    }
    if (!isResolvableBaseUrl(baseUrl)) {
      return {
        status: 'warn',
        detail: 'Teams package base URL is missing or invalid.',
        data: { appId, baseUrl: baseUrl || null },
        recommendations: ['Regenerate the Teams package with a reachable base URL.'],
      };
    }
    return {
      status: 'pass',
      detail: 'Teams package metadata is present.',
      data: { appId, baseUrl },
    };
  });

  await runStep('bot_connector', 'Bot connector credentials', async () => {
    if (!isBotConnectorConfigured()) {
      return {
        status: 'fail',
        detail: 'Teams bot connector credentials are not configured.',
        recommendations: [BOT_ENV_RECOMMENDATION],
      };
    }
    return { status: 'pass', detail: 'Teams bot connector credentials are configured.' };
  });

  await runStep('user_linkage', 'Admin Microsoft account linkage', async () => {
    const recipientLink = await resolveTeamsRecipientLink(tenant, userId);
    if (!recipientLink) {
      return {
        status: 'warn',
        detail: 'The current admin is not linked to a Microsoft account.',
        recommendations: [LINK_MICROSOFT_ACCOUNT_RECOMMENDATION],
      };
    }
    microsoftUserId = recipientLink.providerAccountId;
    return {
      status: 'pass',
      detail: 'The current admin is linked to a Microsoft account.',
      data: { microsoftUserId },
    };
  });

  await runStep('conversation_reference', 'Admin Teams conversation reference', async () => {
    if (!microsoftUserId) {
      return {
        status: 'warn',
        detail: 'A Microsoft account link is required before a conversation reference can be checked.',
        recommendations: [LINK_MICROSOFT_ACCOUNT_RECOMMENDATION],
      };
    }
    const reference = await getLatestTeamsConversationReferenceImpl({
      tenant,
      microsoftUserId,
    });
    if (!reference) {
      return {
        status: 'warn',
        detail: MISSING_CONVERSATION_REFERENCE_DETAIL,
        recommendations: [MESSAGE_BOT_RECOMMENDATION],
      };
    }
    conversationReferenceFound = true;
    return {
      status: 'pass',
      detail: 'A personal Teams conversation reference exists for the current admin.',
      data: {
        conversationId: reference.conversationId,
        lastActivityAt: reference.lastActivityAt,
      },
    };
  });

  await runStep('recent_delivery_health', 'Recent Teams delivery health', async () => {
    const [lastSuccess, lastFailure, lastAttempt] = await Promise.all([
      getLatestDelivery(knex, tenant, ['sent', 'delivered']),
      getLatestDelivery(knex, tenant, ['failed']),
      getLatestDelivery(knex, tenant),
    ]);
    const data = {
      lastSuccess: mapDeliveryRow(lastSuccess),
      lastFailure: mapDeliveryRow(lastFailure),
      lastAttempt: mapDeliveryRow(lastAttempt),
    };
    if (lastAttempt?.status === 'failed') {
      return {
        status: 'warn',
        detail: `Most recent Teams delivery failed: ${normalizeString(lastAttempt.error_message) || normalizeString(lastAttempt.error_code) || 'unknown error'}.`,
        data,
        recommendations: ['Review the most recent Teams delivery failure and retry after correcting the cause.'],
      };
    }
    if (!lastAttempt) {
      return {
        status: conversationReferenceFound ? 'pass' : 'skip',
        detail: 'No Teams delivery attempts have been recorded yet.',
        data,
      };
    }
    return {
      status: 'pass',
      detail: 'Most recent Teams delivery did not fail.',
      data,
    };
  });

  const overallStatus: TeamsDiagnosticsReport['overallStatus'] = steps.some((step) => step.status === 'fail')
    ? 'fail'
    : steps.some((step) => step.status === 'warn')
      ? 'warn'
      : 'pass';

  return {
    createdAt: new Date().toISOString(),
    overallStatus,
    steps,
    recommendations: Array.from(recommendations),
  };
}

export const sendTeamsTestMessage = withAuth(sendTeamsTestMessageImpl);
export const runTeamsDiagnostics = withAuth(runTeamsDiagnosticsImpl);
