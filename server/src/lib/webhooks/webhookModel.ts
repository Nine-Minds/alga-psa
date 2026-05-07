import path from 'node:path';
import crypto from 'node:crypto';

import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import logger from '@alga-psa/core/logger';

import { getConnection } from '@/lib/db/db';

const WEBHOOKS_TABLE = 'webhooks';
const WEBHOOK_DELIVERIES_TABLE = 'webhook_deliveries';
const WEBHOOK_SIGNING_SECRET_PREFIX = 'webhook_signing_secret_';

export interface WebhookRecord {
  tenant: string;
  webhookId: string;
  name: string;
  url: string;
  method: string;
  eventTypes: string[];
  customHeaders: Record<string, string> | null;
  eventFilter: Record<string, unknown> | null;
  /**
   * Per-entity payload field allowlist.
   *   null                       -> full payload for every entity (default).
   *   {}                         -> same as null (no per-entity overrides).
   *   { ticket: null }           -> full payload for that entity (explicit).
   *   { ticket: [] }             -> required-only for that entity.
   *   { ticket: ["title", ...] } -> only these fields (plus required) for it.
   *
   * Entities not present in the map fall back to "full payload".
   */
  payloadFields: Record<string, string[] | null> | null;
  securityType: string;
  verifySsl: boolean;
  retryConfig: Record<string, unknown> | null;
  rateLimitPerMin: number;
  isActive: boolean;
  totalDeliveries: number;
  successfulDeliveries: number;
  failedDeliveries: number;
  lastDeliveryAt: Date | null;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  autoDisabledAt: Date | null;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredWebhookRow extends WebhookRecord {
  signingSecretVaultPath: string;
}

export interface InsertWebhookInput {
  tenant: string;
  webhookId?: string;
  name: string;
  url: string;
  method?: string;
  eventTypes: string[];
  customHeaders?: Record<string, string> | null;
  eventFilter?: Record<string, unknown> | null;
  payloadFields?: Record<string, string[] | null> | null;
  signingSecret: string;
  signingSecretVaultPath?: string;
  securityType?: string;
  verifySsl?: boolean;
  retryConfig?: Record<string, unknown> | null;
  rateLimitPerMin?: number;
  isActive?: boolean;
  createdByUserId: string;
}

export interface UpdateWebhookInput {
  name?: string;
  url?: string;
  method?: string;
  eventTypes?: string[];
  customHeaders?: Record<string, string> | null;
  eventFilter?: Record<string, unknown> | null;
  payloadFields?: Record<string, string[] | null> | null;
  signingSecret?: string;
  signingSecretVaultPath?: string;
  securityType?: string;
  verifySsl?: boolean;
  retryConfig?: Record<string, unknown> | null;
  rateLimitPerMin?: number;
  isActive?: boolean;
  totalDeliveries?: number;
  successfulDeliveries?: number;
  failedDeliveries?: number;
  lastDeliveryAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastFailureAt?: Date | null;
  autoDisabledAt?: Date | null;
}

export interface WebhookDeliveryRecord {
  tenant: string;
  deliveryId: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  requestHeaders: Record<string, string> | null;
  requestBody: unknown;
  responseStatusCode: number | null;
  responseHeaders: Record<string, string> | null;
  responseBody: string | null;
  status: string;
  attemptNumber: number;
  durationMs: number | null;
  errorMessage: string | null;
  nextRetryAt: Date | null;
  isTest: boolean;
  attemptedAt: Date;
  completedAt: Date | null;
}

export interface RecordDeliveryInput {
  tenant: string;
  deliveryId?: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  requestHeaders?: Record<string, string> | null;
  requestBody?: unknown;
  responseStatusCode?: number | null;
  responseHeaders?: Record<string, string> | null;
  responseBody?: string | null;
  status: string;
  attemptNumber?: number;
  durationMs?: number | null;
  errorMessage?: string | null;
  nextRetryAt?: Date | null;
  isTest?: boolean;
  attemptedAt?: Date;
  completedAt?: Date | null;
}

export interface UpdateWebhookStatsInput {
  tenant: string;
  webhookId: string;
  succeeded: boolean;
  deliveredAt?: Date;
}

export interface MarkAbandonedInput {
  tenant: string;
  deliveryId: string;
  errorMessage?: string | null;
  completedAt?: Date;
}

export interface ListWebhookDeliveriesOptions {
  page?: number;
  limit?: number;
}

function mapWebhookRow(row: any): WebhookRecord {
  return {
    tenant: row.tenant,
    webhookId: row.webhook_id,
    name: row.name,
    url: row.url,
    method: row.method,
    eventTypes: row.event_types ?? [],
    customHeaders: row.custom_headers ?? null,
    eventFilter: row.event_filter ?? null,
    payloadFields: row.payload_fields ?? null,
    securityType: row.security_type,
    verifySsl: row.verify_ssl,
    retryConfig: row.retry_config ?? null,
    rateLimitPerMin: row.rate_limit_per_min,
    isActive: row.is_active,
    totalDeliveries: row.total_deliveries,
    successfulDeliveries: row.successful_deliveries,
    failedDeliveries: row.failed_deliveries,
    lastDeliveryAt: row.last_delivery_at ?? null,
    lastSuccessAt: row.last_success_at ?? null,
    lastFailureAt: row.last_failure_at ?? null,
    autoDisabledAt: row.auto_disabled_at ?? null,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapStoredWebhookRow(row: any): StoredWebhookRow {
  return {
    ...mapWebhookRow(row),
    signingSecretVaultPath: row.signing_secret_vault_path,
  };
}

function mapDeliveryRow(row: any): WebhookDeliveryRecord {
  return {
    tenant: row.tenant,
    deliveryId: row.delivery_id,
    webhookId: row.webhook_id,
    eventId: row.event_id,
    eventType: row.event_type,
    requestHeaders: row.request_headers ?? null,
    requestBody: row.request_body ?? null,
    responseStatusCode: row.response_status_code ?? null,
    responseHeaders: row.response_headers ?? null,
    responseBody: row.response_body ?? null,
    status: row.status,
    attemptNumber: row.attempt_number,
    durationMs: row.duration_ms ?? null,
    errorMessage: row.error_message ?? null,
    nextRetryAt: row.next_retry_at ?? null,
    isTest: row.is_test,
    attemptedAt: row.attempted_at,
    completedAt: row.completed_at ?? null,
  };
}

function buildWebhookUpdatePayload(input: UpdateWebhookInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (input.name !== undefined) payload.name = input.name;
  if (input.url !== undefined) payload.url = input.url;
  if (input.method !== undefined) payload.method = input.method;
  if (input.eventTypes !== undefined) payload.event_types = input.eventTypes;
  if (input.customHeaders !== undefined) payload.custom_headers = input.customHeaders;
  if (input.eventFilter !== undefined) payload.event_filter = input.eventFilter;
  if (input.payloadFields !== undefined) payload.payload_fields = input.payloadFields;
  if (input.securityType !== undefined) payload.security_type = input.securityType;
  if (input.verifySsl !== undefined) payload.verify_ssl = input.verifySsl;
  if (input.retryConfig !== undefined) payload.retry_config = input.retryConfig;
  if (input.rateLimitPerMin !== undefined) payload.rate_limit_per_min = input.rateLimitPerMin;
  if (input.isActive !== undefined) payload.is_active = input.isActive;
  if (input.totalDeliveries !== undefined) payload.total_deliveries = input.totalDeliveries;
  if (input.successfulDeliveries !== undefined) payload.successful_deliveries = input.successfulDeliveries;
  if (input.failedDeliveries !== undefined) payload.failed_deliveries = input.failedDeliveries;
  if (input.lastDeliveryAt !== undefined) payload.last_delivery_at = input.lastDeliveryAt;
  if (input.lastSuccessAt !== undefined) payload.last_success_at = input.lastSuccessAt;
  if (input.lastFailureAt !== undefined) payload.last_failure_at = input.lastFailureAt;
  if (input.autoDisabledAt !== undefined) payload.auto_disabled_at = input.autoDisabledAt;

  return payload;
}

export function buildWebhookSigningSecretName(webhookId: string): string {
  return `${WEBHOOK_SIGNING_SECRET_PREFIX}${webhookId}`;
}

export function buildWebhookSigningSecretVaultPath(
  tenant: string,
  secretName: string,
): string {
  return `tenant/${tenant}/${secretName}`;
}

export function getSigningSecretNameFromVaultPath(vaultPath: string): string {
  return path.posix.basename(vaultPath);
}

async function getStoredWebhook(
  webhookId: string,
  tenant: string,
): Promise<StoredWebhookRow | null> {
  const knex = await getConnection(tenant);
  const row = await knex(WEBHOOKS_TABLE)
    .where({
      tenant,
      webhook_id: webhookId,
    })
    .first();

  return row ? mapStoredWebhookRow(row) : null;
}

async function setSigningSecret(
  tenant: string,
  vaultPath: string,
  secret: string,
): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(
    tenant,
    getSigningSecretNameFromVaultPath(vaultPath),
    secret,
  );
}

async function deleteSigningSecret(tenant: string, vaultPath: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.deleteTenantSecret(
    tenant,
    getSigningSecretNameFromVaultPath(vaultPath),
  );
}

async function getById(webhookId: string, tenant: string): Promise<WebhookRecord | null> {
  const stored = await getStoredWebhook(webhookId, tenant);
  if (!stored) {
    return null;
  }

  const { signingSecretVaultPath: _signingSecretVaultPath, ...webhook } = stored;
  return webhook;
}

async function listForEventType(
  tenant: string,
  eventType: string,
): Promise<WebhookRecord[]> {
  const knex = await getConnection(tenant);
  const rows = await knex(WEBHOOKS_TABLE)
    .where({
      tenant,
      is_active: true,
    })
    .whereRaw('? = ANY(event_types)', [eventType])
    .orderBy('created_at', 'asc');

  return rows.map(mapWebhookRow);
}

async function listByTenant(tenant: string): Promise<WebhookRecord[]> {
  const knex = await getConnection(tenant);
  const rows = await knex(WEBHOOKS_TABLE)
    .where({ tenant })
    .orderBy('created_at', 'desc');

  return rows.map(mapWebhookRow);
}

async function insert(input: InsertWebhookInput): Promise<WebhookRecord> {
  const webhookId = input.webhookId ?? crypto.randomUUID();
  const signingSecretVaultPath =
    input.signingSecretVaultPath ??
    buildWebhookSigningSecretVaultPath(
      input.tenant,
      buildWebhookSigningSecretName(webhookId),
    );

  await setSigningSecret(input.tenant, signingSecretVaultPath, input.signingSecret);

  const knex = await getConnection(input.tenant);

  try {
    const [row] = await knex(WEBHOOKS_TABLE)
      .insert({
        tenant: input.tenant,
        webhook_id: webhookId,
        name: input.name,
        url: input.url,
        method: input.method ?? 'POST',
        event_types: input.eventTypes,
        custom_headers: input.customHeaders ?? null,
        event_filter: input.eventFilter ?? null,
        payload_fields: input.payloadFields ?? null,
        signing_secret_vault_path: signingSecretVaultPath,
        security_type: input.securityType ?? 'hmac_signature',
        verify_ssl: input.verifySsl ?? true,
        retry_config: input.retryConfig ?? null,
        rate_limit_per_min: input.rateLimitPerMin ?? 100,
        is_active: input.isActive ?? true,
        created_by_user_id: input.createdByUserId,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })
      .returning('*');

    return mapWebhookRow(row);
  } catch (error) {
    await deleteSigningSecret(input.tenant, signingSecretVaultPath).catch((secretError) => {
      logger.warn('[webhookModel] Failed to roll back signing secret after insert failure', {
        tenant: input.tenant,
        webhookId,
        signingSecretVaultPath,
        secretError,
      });
    });
    throw error;
  }
}

async function update(
  webhookId: string,
  tenant: string,
  input: UpdateWebhookInput,
): Promise<WebhookRecord | null> {
  const existing = await getStoredWebhook(webhookId, tenant);
  if (!existing) {
    return null;
  }

  let nextVaultPath = existing.signingSecretVaultPath;
  const shouldWriteSecret = input.signingSecret !== undefined;

  if (input.signingSecretVaultPath !== undefined) {
    nextVaultPath = input.signingSecretVaultPath;
  }

  if (shouldWriteSecret) {
    await setSigningSecret(tenant, nextVaultPath, input.signingSecret!);
  }

  const updatePayload = buildWebhookUpdatePayload(input);
  if (input.signingSecretVaultPath !== undefined) {
    updatePayload.signing_secret_vault_path = input.signingSecretVaultPath;
  }
  updatePayload.updated_at = new Date();

  const knex = await getConnection(tenant);

  try {
    const [row] = await knex(WEBHOOKS_TABLE)
      .where({
        tenant,
        webhook_id: webhookId,
      })
      .update(updatePayload)
      .returning('*');

    if (
      shouldWriteSecret &&
      existing.signingSecretVaultPath !== nextVaultPath
    ) {
      await deleteSigningSecret(tenant, existing.signingSecretVaultPath).catch((secretError) => {
        logger.warn('[webhookModel] Failed to delete superseded signing secret', {
          tenant,
          webhookId,
          signingSecretVaultPath: existing.signingSecretVaultPath,
          secretError,
        });
      });
    }

    return row ? mapWebhookRow(row) : null;
  } catch (error) {
    if (shouldWriteSecret && existing.signingSecretVaultPath !== nextVaultPath) {
      await deleteSigningSecret(tenant, nextVaultPath).catch((secretError) => {
        logger.warn('[webhookModel] Failed to clean up new signing secret after update failure', {
          tenant,
          webhookId,
          signingSecretVaultPath: nextVaultPath,
          secretError,
        });
      });
    }
    throw error;
  }
}

async function deleteWebhook(
  webhookId: string,
  tenant: string,
): Promise<WebhookRecord | null> {
  const existing = await getStoredWebhook(webhookId, tenant);
  if (!existing) {
    return null;
  }

  const knex = await getConnection(tenant);
  await knex(WEBHOOKS_TABLE)
    .where({
      tenant,
      webhook_id: webhookId,
    })
    .del();

  await deleteSigningSecret(tenant, existing.signingSecretVaultPath).catch((secretError) => {
    logger.warn('[webhookModel] Failed to delete signing secret after webhook deletion', {
      tenant,
      webhookId,
      signingSecretVaultPath: existing.signingSecretVaultPath,
      secretError,
    });
  });

  const { signingSecretVaultPath: _signingSecretVaultPath, ...webhook } = existing;
  return webhook;
}

async function recordDelivery(
  input: RecordDeliveryInput,
): Promise<WebhookDeliveryRecord> {
  const knex = await getConnection(input.tenant);
  const [row] = await knex(WEBHOOK_DELIVERIES_TABLE)
    .insert({
      tenant: input.tenant,
      delivery_id: input.deliveryId ?? crypto.randomUUID(),
      webhook_id: input.webhookId,
      event_id: input.eventId,
      event_type: input.eventType,
      request_headers: input.requestHeaders ?? null,
      request_body: input.requestBody ?? null,
      response_status_code: input.responseStatusCode ?? null,
      response_headers: input.responseHeaders ?? null,
      response_body: input.responseBody ?? null,
      status: input.status,
      attempt_number: input.attemptNumber ?? 1,
      duration_ms: input.durationMs ?? null,
      error_message: input.errorMessage ?? null,
      next_retry_at: input.nextRetryAt ?? null,
      is_test: input.isTest ?? false,
      attempted_at: input.attemptedAt ?? knex.fn.now(),
      completed_at: input.completedAt ?? null,
    })
    .returning('*');

  return mapDeliveryRow(row);
}

async function getDeliveryById(
  tenant: string,
  webhookId: string,
  deliveryId: string,
): Promise<WebhookDeliveryRecord | null> {
  const knex = await getConnection(tenant);
  const row = await knex(WEBHOOK_DELIVERIES_TABLE)
    .where({
      tenant,
      webhook_id: webhookId,
      delivery_id: deliveryId,
    })
    .first();

  return row ? mapDeliveryRow(row) : null;
}

async function listDeliveries(
  tenant: string,
  webhookId: string,
  options: ListWebhookDeliveriesOptions = {},
): Promise<{
  data: WebhookDeliveryRecord[];
  page: number;
  limit: number;
  total: number;
}> {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
  const offset = (page - 1) * limit;
  const knex = await getConnection(tenant);

  const [rows, totalRow] = await Promise.all([
    knex(WEBHOOK_DELIVERIES_TABLE)
      .where({
        tenant,
        webhook_id: webhookId,
      })
      .orderBy('attempted_at', 'desc')
      .limit(limit)
      .offset(offset),
    knex(WEBHOOK_DELIVERIES_TABLE)
      .where({
        tenant,
        webhook_id: webhookId,
      })
      .count<{ count: string }[]>({ count: '*' })
      .first(),
  ]);

  return {
    data: rows.map(mapDeliveryRow),
    page,
    limit,
    total: Number(totalRow?.count ?? 0),
  };
}

async function updateStats(
  input: UpdateWebhookStatsInput,
): Promise<WebhookRecord | null> {
  const deliveredAt = input.deliveredAt ?? new Date();
  const knex = await getConnection(input.tenant);
  const payload: Record<string, unknown> = {
    total_deliveries: knex.raw('?? + 1', ['total_deliveries']),
    last_delivery_at: deliveredAt,
    updated_at: knex.fn.now(),
  };

  if (input.succeeded) {
    payload.successful_deliveries = knex.raw('?? + 1', ['successful_deliveries']);
    payload.last_success_at = deliveredAt;
  } else {
    payload.failed_deliveries = knex.raw('?? + 1', ['failed_deliveries']);
    payload.last_failure_at = deliveredAt;
  }

  const [row] = await knex(WEBHOOKS_TABLE)
    .where({
      tenant: input.tenant,
      webhook_id: input.webhookId,
    })
    .update(payload)
    .returning('*');

  return row ? mapWebhookRow(row) : null;
}

async function markAbandoned(
  input: MarkAbandonedInput,
): Promise<WebhookDeliveryRecord | null> {
  const knex = await getConnection(input.tenant);
  const [row] = await knex(WEBHOOK_DELIVERIES_TABLE)
    .where({
      tenant: input.tenant,
      delivery_id: input.deliveryId,
    })
    .update({
      status: 'abandoned',
      error_message: input.errorMessage ?? null,
      next_retry_at: null,
      completed_at: input.completedAt ?? knex.fn.now(),
    })
    .returning('*');

  return row ? mapDeliveryRow(row) : null;
}

async function getSigningSecret(
  webhookId: string,
  tenant: string,
): Promise<string | null> {
  const stored = await getStoredWebhook(webhookId, tenant);
  if (!stored) {
    return null;
  }

  const secretProvider = await getSecretProviderInstance();
  const secret = await secretProvider.getTenantSecret(
    tenant,
    getSigningSecretNameFromVaultPath(stored.signingSecretVaultPath),
  );

  return secret ?? null;
}

export const webhookModel = {
  getById,
  listForEventType,
  listByTenant,
  insert,
  update,
  delete: deleteWebhook,
  recordDelivery,
  getDeliveryById,
  listDeliveries,
  updateStats,
  markAbandoned,
  getSigningSecret,
};
