import axios from 'axios';
import { Connection, Client } from '@temporalio/client';
import logger from '@alga-psa/core/logger';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import { buildIntegrationTokenRefreshFailedPayload } from '@alga-psa/workflow-streams';
import { createTenantKnex, runWithTenant } from '@/lib/db';
import type {
  NinjaOneOAuthCredentials,
  NinjaOneOAuthTokenResponse,
} from '../../../interfaces/ninjaone.interfaces';
import type { RmmIntegration } from '../../../interfaces/rmm.interfaces';

const NINJAONE_CREDENTIALS_SECRET = 'ninjaone_credentials';
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';
const NINJAONE_CLIENT_SECRET_SECRET = 'ninjaone_client_secret';

const DEFAULT_TEMPORAL_ADDRESS = 'temporal-frontend.temporal.svc.cluster.local:7233';
const DEFAULT_TEMPORAL_NAMESPACE = 'default';
const DEFAULT_TEMPORAL_TASK_QUEUE = 'alga-jobs';

const DEFAULT_REFRESH_BUFFER_SECONDS = 15 * 60;
const DEFAULT_MIN_REFRESH_DELAY_SECONDS = 30;
const DEFAULT_REFRESH_WORKFLOW_TIMEOUT = '20m';

export const NINJAONE_PROACTIVE_REFRESH_WORKFLOW_NAME = 'ninjaOneProactiveTokenRefreshWorkflow';

export type NinjaOneRefreshScheduleSource =
  | 'oauth_connected'
  | 'lazy_refresh_success'
  | 'proactive_refresh_success'
  | 'reconnected'
  | 'backfill';

interface NinjaOneTokenLifecycleFailure {
  code?: string;
  message: string;
  retryable: boolean;
  failedAt: string;
}

interface NinjaOneTokenLifecycleState {
  status?: 'scheduled' | 'healthy' | 'reconnect_required' | 'unschedulable' | 'inactive';
  reconnectRequired?: boolean;
  reconnectReason?: string;
  scheduleNonce?: number;
  activeWorkflowId?: string;
  nextRefreshAt?: string;
  lastScheduledAt?: string;
  lastScheduleSource?: NinjaOneRefreshScheduleSource;
  lastRefreshAttemptAt?: string;
  lastRefreshAt?: string;
  lastRefreshFailure?: NinjaOneTokenLifecycleFailure;
}

type IntegrationSettingsRecord = Record<string, unknown>;

interface NinjaOneIntegrationSettings extends IntegrationSettingsRecord {
  tokenLifecycle?: NinjaOneTokenLifecycleState;
}

interface TokenLifecycleUpdate {
  tokenLifecycle: NinjaOneTokenLifecycleState;
}

export interface ScheduleNinjaOneProactiveRefreshInput {
  tenantId: string;
  integrationId: string;
  expiresAtMs: number;
  source: NinjaOneRefreshScheduleSource;
}

export interface ScheduleNinjaOneProactiveRefreshResult {
  scheduled: boolean;
  workflowId?: string;
  refreshAt?: string;
  reason?: string;
}

export interface NinjaOneProactiveRefreshWorkflowInput {
  tenantId: string;
  integrationId: string;
  scheduleNonce: number;
  scheduledFor: string;
  scheduledBy: NinjaOneRefreshScheduleSource;
}

export interface ExecuteNinjaOneProactiveRefreshInput {
  tenantId: string;
  integrationId: string;
  scheduleNonce: number;
  scheduledFor: string;
}

export interface ExecuteNinjaOneProactiveRefreshResult {
  outcome: 'success' | 'stale_schedule' | 'inactive' | 'reconnect_required' | 'unschedulable';
  details?: string;
}

function getRefreshBufferMs(): number {
  const raw = Number.parseInt(process.env.NINJAONE_PROACTIVE_REFRESH_BUFFER_SECONDS || '', 10);
  const value = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REFRESH_BUFFER_SECONDS;
  return value * 1000;
}

function getMinRefreshDelayMs(): number {
  const raw = Number.parseInt(process.env.NINJAONE_PROACTIVE_REFRESH_MIN_DELAY_SECONDS || '', 10);
  const value = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MIN_REFRESH_DELAY_SECONDS;
  return value * 1000;
}

function computeRefreshTime(expiresAtMs: number): Date {
  const now = Date.now();
  const target = expiresAtMs - getRefreshBufferMs();
  const minAllowed = now + getMinRefreshDelayMs();
  return new Date(Math.max(target, minAllowed));
}

function parseIntegrationSettings(value: unknown): NinjaOneIntegrationSettings {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value as NinjaOneIntegrationSettings;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object') {
        return parsed as NinjaOneIntegrationSettings;
      }
    } catch {
      // ignore malformed settings and fall back to empty.
    }
  }

  return {};
}

function mergeLifecycleSettings(
  currentSettings: unknown,
  update: TokenLifecycleUpdate
): NinjaOneIntegrationSettings {
  const parsed = parseIntegrationSettings(currentSettings);
  return {
    ...parsed,
    tokenLifecycle: {
      ...parsed.tokenLifecycle,
      ...update.tokenLifecycle,
    },
  };
}

function buildRefreshWorkflowId(tenantId: string, integrationId: string, scheduleNonce: number): string {
  return `ninjaone:token-refresh:${tenantId}:${integrationId}:${scheduleNonce}`;
}

function extractErrorInfo(error: unknown): object {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

async function getTemporalClient(): Promise<Client> {
  const address = process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
  const namespace = process.env.TEMPORAL_NAMESPACE || DEFAULT_TEMPORAL_NAMESPACE;
  const connection = await Connection.connect({ address });
  return new Client({ connection, namespace });
}

function getTemporalTaskQueue(): string {
  return process.env.TEMPORAL_JOB_TASK_QUEUE || DEFAULT_TEMPORAL_TASK_QUEUE;
}

async function fetchIntegration(
  tenantId: string,
  integrationId: string
): Promise<RmmIntegration | undefined> {
  return runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    return (await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId, provider: 'ninjaone' })
      .first()) as RmmIntegration | undefined;
  });
}

async function updateIntegrationLifecycle(
  tenantId: string,
  integrationId: string,
  update: TokenLifecycleUpdate
): Promise<void> {
  await runWithTenant(tenantId, async () => {
    const { knex } = await createTenantKnex();
    const row = await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId, provider: 'ninjaone' })
      .select('settings')
      .first();

    if (!row) {
      return;
    }

    const merged = mergeLifecycleSettings(row.settings, update);

    await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId, provider: 'ninjaone' })
      .update({
        settings: JSON.stringify(merged),
        updated_at: knex.fn.now(),
      });
  });
}

async function terminateExistingWorkflow(workflowId?: string): Promise<void> {
  if (!workflowId) {
    return;
  }

  try {
    const client = await getTemporalClient();
    const handle = client.workflow.getHandle(workflowId);
    await handle.terminate('superseded_ninjaone_refresh_schedule');
  } catch (error) {
    logger.warn('[NinjaOneProactiveRefresh] Failed to terminate existing workflow', {
      workflowId,
      error: extractErrorInfo(error),
    });
  }
}

async function loadNinjaOneCredentials(tenantId: string): Promise<NinjaOneOAuthCredentials | null> {
  const secretProvider = await getSecretProviderInstance();
  const credentialsJson = await secretProvider.getTenantSecret(tenantId, NINJAONE_CREDENTIALS_SECRET);

  if (!credentialsJson) {
    return null;
  }

  try {
    return JSON.parse(credentialsJson) as NinjaOneOAuthCredentials;
  } catch {
    return null;
  }
}

async function saveNinjaOneCredentials(tenantId: string, credentials: NinjaOneOAuthCredentials): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(
    tenantId,
    NINJAONE_CREDENTIALS_SECRET,
    JSON.stringify(credentials)
  );
}

async function resolveNinjaOneClientCredentials(
  tenantId?: string
): Promise<{ clientId?: string; clientSecret?: string }> {
  const secretProvider = await getSecretProviderInstance();

  let clientId: string | undefined;
  let clientSecret: string | undefined;

  if (tenantId) {
    clientId = await secretProvider.getTenantSecret(tenantId, NINJAONE_CLIENT_ID_SECRET);
    clientSecret = await secretProvider.getTenantSecret(tenantId, NINJAONE_CLIENT_SECRET_SECRET);
  }

  if (!clientId) {
    clientId = await secretProvider.getAppSecret(NINJAONE_CLIENT_ID_SECRET);
  }
  if (!clientSecret) {
    clientSecret = await secretProvider.getAppSecret(NINJAONE_CLIENT_SECRET_SECRET);
  }

  if (!clientId) {
    clientId = process.env.NINJAONE_CLIENT_ID;
  }
  if (!clientSecret) {
    clientSecret = process.env.NINJAONE_CLIENT_SECRET;
  }

  return { clientId, clientSecret };
}

function isTerminalRefreshFailure(error: unknown): boolean {
  if (!axios.isAxiosError(error)) {
    return false;
  }

  const status = error.response?.status;
  const data = error.response?.data as { error?: string; error_description?: string } | undefined;
  const code = `${data?.error || ''}`.toLowerCase();
  const description = `${data?.error_description || ''}`.toLowerCase();

  if (status === 400 && (code.includes('invalid_token') || code.includes('invalid_grant'))) {
    return true;
  }

  if (status === 401 && (description.includes('invalid token') || description.includes('invalid refresh'))) {
    return true;
  }

  return false;
}

function buildFailureMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data;
    const parts = [status ? `status=${status}` : '', error.message, data ? JSON.stringify(data) : '']
      .filter(Boolean)
      .join(' | ');
    return parts.slice(0, 500) || 'NinjaOne token refresh failed';
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function publishProactiveTokenRefreshFailedEvent(input: {
  tenantId: string;
  integrationId: string;
  errorCode?: string;
  errorMessage: string;
  retryable: boolean;
}): Promise<void> {
  try {
    const nowIso = new Date().toISOString();
    const bucket = Math.floor(Date.now() / (5 * 60 * 1000));
    await publishWorkflowEvent({
      eventType: 'INTEGRATION_TOKEN_REFRESH_FAILED',
      payload: buildIntegrationTokenRefreshFailedPayload({
        integrationId: input.integrationId,
        provider: 'ninjaone',
        connectionId: input.integrationId,
        failedAt: nowIso,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        retryable: input.retryable,
      }),
      ctx: {
        tenantId: input.tenantId,
        occurredAt: nowIso,
        actor: { actorType: 'SYSTEM' },
      },
      idempotencyKey: `integration_token_refresh_failed:proactive:${input.tenantId}:${input.integrationId}:${bucket}`,
    });
  } catch (error) {
    logger.warn('[NinjaOneProactiveRefresh] Failed to publish proactive token refresh failed event', {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      error: extractErrorInfo(error),
    });
  }
}

export async function scheduleNinjaOneProactiveRefresh(
  input: ScheduleNinjaOneProactiveRefreshInput
): Promise<ScheduleNinjaOneProactiveRefreshResult> {
  const integration = await fetchIntegration(input.tenantId, input.integrationId);

  if (!integration) {
    return { scheduled: false, reason: 'integration_not_found' };
  }

  if (!integration.is_active) {
    return { scheduled: false, reason: 'integration_inactive' };
  }

  const settings = parseIntegrationSettings(integration.settings);
  const lifecycle = settings.tokenLifecycle || {};
  if (lifecycle.reconnectRequired) {
    return { scheduled: false, reason: 'reconnect_required' };
  }

  const refreshAt = computeRefreshTime(input.expiresAtMs);
  const now = Date.now();
  const delayMs = Math.max(0, refreshAt.getTime() - now);
  const nextScheduleNonce = (lifecycle.scheduleNonce || 0) + 1;
  const workflowId = buildRefreshWorkflowId(input.tenantId, input.integrationId, nextScheduleNonce);

  await terminateExistingWorkflow(lifecycle.activeWorkflowId);

  const client = await getTemporalClient();
  await client.workflow.start(NINJAONE_PROACTIVE_REFRESH_WORKFLOW_NAME, {
    taskQueue: getTemporalTaskQueue(),
    workflowId,
    workflowExecutionTimeout: DEFAULT_REFRESH_WORKFLOW_TIMEOUT,
    startDelay: `${delayMs}ms`,
    args: [{
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      scheduleNonce: nextScheduleNonce,
      scheduledFor: refreshAt.toISOString(),
      scheduledBy: input.source,
    } satisfies NinjaOneProactiveRefreshWorkflowInput],
  });

  await updateIntegrationLifecycle(input.tenantId, input.integrationId, {
    tokenLifecycle: {
      status: 'scheduled',
      reconnectRequired: false,
      reconnectReason: undefined,
      scheduleNonce: nextScheduleNonce,
      activeWorkflowId: workflowId,
      nextRefreshAt: refreshAt.toISOString(),
      lastScheduledAt: new Date().toISOString(),
      lastScheduleSource: input.source,
      lastRefreshFailure: undefined,
    },
  });

  logger.info('[NinjaOneProactiveRefresh] Scheduled token refresh workflow', {
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    workflowId,
    refreshAt: refreshAt.toISOString(),
    expiresAt: new Date(input.expiresAtMs).toISOString(),
    source: input.source,
  });

  return {
    scheduled: true,
    workflowId,
    refreshAt: refreshAt.toISOString(),
  };
}

export async function clearNinjaOneReconnectRequiredState(
  tenantId: string,
  integrationId: string
): Promise<void> {
  await updateIntegrationLifecycle(tenantId, integrationId, {
    tokenLifecycle: {
      reconnectRequired: false,
      reconnectReason: undefined,
      status: 'healthy',
      lastRefreshFailure: undefined,
    },
  });
}

export async function cancelNinjaOneProactiveRefresh(
  tenantId: string,
  integrationId: string,
  reason: 'disconnect' | 'terminal_failure' | 'manual_reset'
): Promise<void> {
  const integration = await fetchIntegration(tenantId, integrationId);
  if (!integration) {
    return;
  }

  const settings = parseIntegrationSettings(integration.settings);
  const existingWorkflowId = settings.tokenLifecycle?.activeWorkflowId;

  await terminateExistingWorkflow(existingWorkflowId);

  await updateIntegrationLifecycle(tenantId, integrationId, {
    tokenLifecycle: {
      status: reason === 'disconnect' ? 'inactive' : settings.tokenLifecycle?.status,
      activeWorkflowId: undefined,
      nextRefreshAt: undefined,
    },
  });
}

async function markReconnectRequired(
  tenantId: string,
  integrationId: string,
  reason: string,
  message: string
): Promise<void> {
  await cancelNinjaOneProactiveRefresh(tenantId, integrationId, 'terminal_failure');

  await updateIntegrationLifecycle(tenantId, integrationId, {
    tokenLifecycle: {
      reconnectRequired: true,
      reconnectReason: reason,
      status: 'reconnect_required',
      lastRefreshFailure: {
        code: reason,
        message,
        retryable: false,
        failedAt: new Date().toISOString(),
      },
    },
  });
}

async function markUnschedulable(
  tenantId: string,
  integrationId: string,
  details: string
): Promise<void> {
  await cancelNinjaOneProactiveRefresh(tenantId, integrationId, 'manual_reset');
  await updateIntegrationLifecycle(tenantId, integrationId, {
    tokenLifecycle: {
      status: 'unschedulable',
      reconnectRequired: true,
      reconnectReason: 'missing_or_invalid_credentials',
      lastRefreshFailure: {
        code: 'missing_or_invalid_credentials',
        message: details,
        retryable: false,
        failedAt: new Date().toISOString(),
      },
    },
  });
}

export async function executeNinjaOneProactiveRefresh(
  input: ExecuteNinjaOneProactiveRefreshInput
): Promise<ExecuteNinjaOneProactiveRefreshResult> {
  const integration = await fetchIntegration(input.tenantId, input.integrationId);
  if (!integration) {
    return { outcome: 'inactive', details: 'integration_not_found' };
  }

  if (!integration.is_active) {
    return { outcome: 'inactive', details: 'integration_inactive' };
  }

  const settings = parseIntegrationSettings(integration.settings);
  const lifecycle = settings.tokenLifecycle;

  if (!lifecycle) {
    return { outcome: 'stale_schedule', details: 'missing_lifecycle' };
  }

  if ((lifecycle.scheduleNonce || 0) !== input.scheduleNonce) {
    return { outcome: 'stale_schedule', details: 'nonce_mismatch' };
  }

  if (lifecycle.reconnectRequired) {
    return { outcome: 'reconnect_required', details: 'reconnect_required_already' };
  }

  await updateIntegrationLifecycle(input.tenantId, input.integrationId, {
    tokenLifecycle: {
      lastRefreshAttemptAt: new Date().toISOString(),
      activeWorkflowId: lifecycle.activeWorkflowId,
    },
  });

  const credentials = await loadNinjaOneCredentials(input.tenantId);
  if (!credentials?.refresh_token || !credentials?.instance_url || !credentials.expires_at) {
    await markUnschedulable(input.tenantId, input.integrationId, 'Missing or unreadable NinjaOne credentials');
    return { outcome: 'unschedulable', details: 'missing_or_unreadable_credentials' };
  }

  const { clientId, clientSecret } = await resolveNinjaOneClientCredentials(input.tenantId);
  if (!clientId || !clientSecret) {
    await markUnschedulable(input.tenantId, input.integrationId, 'Missing NinjaOne client credentials');
    return { outcome: 'unschedulable', details: 'missing_client_credentials' };
  }

  const tokenUrl = `${credentials.instance_url.replace(/\/+$/, '')}/oauth/token`;

  try {
    const response = await axios.post<NinjaOneOAuthTokenResponse>(
      tokenUrl,
      new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: credentials.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }).toString(),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        timeout: 30000,
      }
    );

    const { access_token, refresh_token, expires_in } = response.data;

    const nextCredentials: NinjaOneOAuthCredentials = {
      access_token,
      refresh_token,
      expires_at: Date.now() + expires_in * 1000,
      instance_url: credentials.instance_url,
    };

    await saveNinjaOneCredentials(input.tenantId, nextCredentials);

    await updateIntegrationLifecycle(input.tenantId, input.integrationId, {
      tokenLifecycle: {
        status: 'healthy',
        reconnectRequired: false,
        reconnectReason: undefined,
        lastRefreshAt: new Date().toISOString(),
        lastRefreshFailure: undefined,
      },
    });

    await scheduleNinjaOneProactiveRefresh({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      expiresAtMs: nextCredentials.expires_at,
      source: 'proactive_refresh_success',
    });

    logger.info('[NinjaOneProactiveRefresh] Successfully refreshed and rescheduled', {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      scheduledFor: input.scheduledFor,
      previousExpiry: new Date(credentials.expires_at).toISOString(),
      nextExpiry: new Date(nextCredentials.expires_at).toISOString(),
    });

    return { outcome: 'success' };
  } catch (error) {
    const message = buildFailureMessage(error);

    if (isTerminalRefreshFailure(error)) {
      await markReconnectRequired(input.tenantId, input.integrationId, 'invalid_token', message);
      await publishProactiveTokenRefreshFailedEvent({
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        errorCode: 'invalid_token',
        errorMessage: message,
        retryable: false,
      });

      logger.warn('[NinjaOneProactiveRefresh] Terminal token refresh failure. Reconnect required.', {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        scheduledFor: input.scheduledFor,
        error: extractErrorInfo(error),
      });

      return { outcome: 'reconnect_required', details: message };
    }

    await updateIntegrationLifecycle(input.tenantId, input.integrationId, {
      tokenLifecycle: {
        lastRefreshFailure: {
          code: axios.isAxiosError(error) ? (error.response?.status ? String(error.response.status) : error.code) : undefined,
          message,
          retryable: true,
          failedAt: new Date().toISOString(),
        },
      },
    });
    await publishProactiveTokenRefreshFailedEvent({
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      errorCode: axios.isAxiosError(error)
        ? (error.response?.status ? String(error.response.status) : error.code)
        : undefined,
      errorMessage: message,
      retryable: true,
    });

    logger.error('[NinjaOneProactiveRefresh] Retryable token refresh failure', {
      tenantId: input.tenantId,
      integrationId: input.integrationId,
      scheduledFor: input.scheduledFor,
      error: extractErrorInfo(error),
    });

    throw error;
  }
}

export async function seedNinjaOneProactiveRefreshFromStoredCredentials(input: {
  tenantId: string;
  integrationId: string;
  source: NinjaOneRefreshScheduleSource;
}): Promise<ScheduleNinjaOneProactiveRefreshResult> {
  const credentials = await loadNinjaOneCredentials(input.tenantId);
  if (!credentials?.expires_at) {
    await markUnschedulable(input.tenantId, input.integrationId, 'Missing NinjaOne token expiry');
    return { scheduled: false, reason: 'missing_expires_at' };
  }

  return scheduleNinjaOneProactiveRefresh({
    tenantId: input.tenantId,
    integrationId: input.integrationId,
    expiresAtMs: credentials.expires_at,
    source: input.source,
  });
}

export function __privateForTests() {
  return {
    computeRefreshTime,
    buildRefreshWorkflowId,
    parseIntegrationSettings,
    mergeLifecycleSettings,
  };
}
