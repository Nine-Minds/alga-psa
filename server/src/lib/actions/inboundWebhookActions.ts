'use server';

import crypto from 'node:crypto';
import type { Knex } from 'knex';

import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';

import type {
  InboundWebhookAuthConfig,
  InboundWebhookConfig,
  InboundWebhookDelivery,
  InboundWebhookDispatchStatus,
  InboundWebhookHandlerConfig,
  InboundWebhookIdempotencySource,
} from '@/lib/inboundWebhooks/types';
import {
  inboundWebhookUpsertInputSchema,
  type InboundWebhookUpsertInput,
} from '@/lib/inboundWebhooks/schemas';
import { bootstrapInboundWebhookActions } from '@/lib/inboundWebhooks/actions/bootstrap';
import { listActions, type InboundActionTargetField } from '@alga-psa/shared/inboundWebhooks/actions/registry';
import { createInboundDelivery, updateInboundDeliveryOutcome } from '@/lib/inboundWebhooks/deliveryPersistence';
import {
  dispatchInboundWebhookHandler,
  InboundWebhookActionError as InboundWebhookDispatchError,
  InboundWebhookMappingError,
} from '@/lib/inboundWebhooks/dispatcher';
import {
  canUseInboundWebhookWorkflowHandlers,
} from '@/lib/inboundWebhooks/editionGate';

interface InboundWebhookRow {
  tenant: string;
  inbound_webhook_id: string;
  name: string;
  slug: string;
  description: string | null;
  auth_type: string;
  auth_config: Record<string, unknown> | null;
  idempotency_source: Record<string, unknown> | null;
  idempotency_window_seconds: number;
  handler_type: string;
  handler_config: Record<string, unknown> | null;
  sample_payload: unknown | null;
  sample_capture_expires_at: Date | string | null;
  is_active: boolean;
  rate_limit_per_minute: number;
  auto_disabled_at: Date | string | null;
  created_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InboundWebhookDeliveryRow {
  tenant: string;
  delivery_id: string;
  inbound_webhook_id: string | null;
  idempotency_key: string | null;
  received_at: Date | string;
  request_method: string;
  request_path: string;
  request_headers: Record<string, string | string[]>;
  request_body: unknown | null;
  source_ip: string | null;
  user_agent: string | null;
  auth_status: InboundWebhookDelivery['authStatus'];
  dispatch_status: InboundWebhookDispatchStatus;
  handler_outcome: Record<string, unknown> | null;
  response_status: number | null;
  response_body: unknown | null;
  duration_ms: number | null;
  retry_count: number;
  is_replay: boolean;
  replayed_from: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ListInboundDeliveriesFilter {
  inboundWebhookId?: string;
  status?: InboundWebhookDispatchStatus;
  dateFrom?: string | Date;
  dateTo?: string | Date;
}

interface InboundDeliveryPage {
  data: InboundWebhookDelivery[];
  page: number;
  limit: number;
  total: number;
}

interface SendInboundWebhookTestInput {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

function inboundWebhookDispatchOutcomeFromError(error: unknown): Record<string, unknown> {
  if (error instanceof InboundWebhookDispatchError) {
    return error.toOutcome();
  }
  if (error instanceof InboundWebhookMappingError) {
    return { error: error.message };
  }
  return { error: 'Inbound webhook dispatch failed' };
}

export interface InboundActionDefinitionView {
  name: string;
  entityType: string;
  displayName: string;
  description: string;
  targetFields: InboundActionTargetField[];
}

export interface InboundWorkflowOptionView {
  workflowId: string;
  name: string;
  description: string | null;
  status: string | null;
  publishedVersion: number | null;
}

const DEFAULT_DELIVERY_PAGE_SIZE = 25;
const MAX_DELIVERY_PAGE_SIZE = 100;
const SAMPLE_CAPTURE_WINDOW_MS = 5 * 60 * 1000;

export type InboundWebhookServerActionError = ActionMessageError | ActionPermissionError;

class ExpectedInboundWebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedInboundWebhookConfigError';
  }
}

function toExpectedConfigError(message: string): ExpectedInboundWebhookConfigError {
  return new ExpectedInboundWebhookConfigError(message);
}

function safeMapInboundWebhook(row: InboundWebhookRow): InboundWebhookConfig | ActionMessageError {
  try {
    return mapInboundWebhook(row);
  } catch (error) {
    if (error instanceof ExpectedInboundWebhookConfigError) {
      return actionError(error.message);
    }
    throw error;
  }
}

function toIso(value: Date | string | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function redactAuthConfig(authType: string, config: Record<string, unknown> | null): InboundWebhookAuthConfig {
  const raw = config ?? {};

  switch (authType) {
    case 'hmac_sha256':
      return {
        type: 'hmac_sha256',
        signatureHeader: String(raw.signature_header ?? raw.signatureHeader ?? 'X-Alga-Signature'),
        secretVaultPath: String(raw.secret_vault_path ?? raw.secretVaultPath ?? ''),
      };
    case 'bearer':
      return {
        type: 'bearer',
        tokenVaultPath: String(raw.token_vault_path ?? raw.tokenVaultPath ?? ''),
      };
    case 'ip_allowlist':
      return {
        type: 'ip_allowlist',
        ipCidrs: Array.isArray(raw.ip_cidrs)
          ? raw.ip_cidrs.map(String)
          : Array.isArray(raw.ipCidrs)
            ? raw.ipCidrs.map(String)
            : [],
      };
    case 'path_token':
      return {
        type: 'path_token',
        queryParam: String(raw.query_param ?? raw.queryParam ?? 'token'),
        tokenVaultPath: String(raw.token_vault_path ?? raw.tokenVaultPath ?? ''),
      };
    default:
      throw toExpectedConfigError(`Unsupported inbound webhook auth type: ${authType}`);
  }
}

function mapHandlerConfig(handlerType: string, config: Record<string, unknown> | null): InboundWebhookHandlerConfig {
  const raw = config ?? {};

  if (handlerType === 'direct_action') {
    return {
      type: 'direct_action',
      action: String(raw.action ?? ''),
      fieldMapping:
        raw.field_mapping && typeof raw.field_mapping === 'object' && !Array.isArray(raw.field_mapping)
          ? Object.fromEntries(
              Object.entries(raw.field_mapping as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
            )
          : {},
    };
  }

  if (handlerType === 'workflow') {
    return {
      type: 'workflow',
      workflowId: String(raw.workflow_id ?? raw.workflowId ?? ''),
    };
  }

  throw toExpectedConfigError(`Unsupported inbound webhook handler type: ${handlerType}`);
}

function mapIdempotencySource(source: Record<string, unknown> | null): InboundWebhookIdempotencySource | null {
  if (!source) {
    return null;
  }

  if (source.type === 'header' || source.type === 'jsonata') {
    return {
      type: source.type,
      value: String(source.value ?? ''),
    };
  }

  return null;
}

function mapInboundWebhook(row: InboundWebhookRow): InboundWebhookConfig {
  return {
    tenant: row.tenant,
    inboundWebhookId: row.inbound_webhook_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    authType: row.auth_type as InboundWebhookConfig['authType'],
    authConfig: redactAuthConfig(row.auth_type, row.auth_config),
    idempotencySource: mapIdempotencySource(row.idempotency_source),
    idempotencyWindowSeconds: row.idempotency_window_seconds,
    handlerType: row.handler_type as InboundWebhookConfig['handlerType'],
    handlerConfig: mapHandlerConfig(row.handler_type, row.handler_config),
    samplePayload: row.sample_payload,
    sampleCaptureExpiresAt: toIso(row.sample_capture_expires_at),
    isActive: row.is_active,
    rateLimitPerMinute: row.rate_limit_per_minute,
    autoDisabledAt: toIso(row.auto_disabled_at),
    createdBy: row.created_by,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapInboundDelivery(row: InboundWebhookDeliveryRow): InboundWebhookDelivery {
  return {
    tenant: row.tenant,
    deliveryId: row.delivery_id,
    inboundWebhookId: row.inbound_webhook_id,
    idempotencyKey: row.idempotency_key,
    receivedAt: new Date(row.received_at).toISOString(),
    requestMethod: row.request_method,
    requestPath: row.request_path,
    requestHeaders: row.request_headers ?? {},
    requestBody: row.request_body,
    sourceIp: row.source_ip,
    userAgent: row.user_agent,
    authStatus: row.auth_status,
    dispatchStatus: row.dispatch_status,
    handlerOutcome: row.handler_outcome,
    responseStatus: row.response_status,
    responseBody: row.response_body,
    durationMs: row.duration_ms,
    retryCount: row.retry_count,
    isReplay: row.is_replay,
    replayedFrom: row.replayed_from,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapWebhookRowToDispatchWebhook(row: InboundWebhookRow) {
  return {
    tenant: row.tenant,
    slug: row.slug,
    handler_type: row.handler_type,
    handler_config: row.handler_config ?? {},
  };
}

function buildSecretName(inboundWebhookId: string, kind: string): string {
  return `inbound_webhook_${inboundWebhookId}_${kind}`;
}

function buildSecretVaultPath(secretName: string): string {
  return `inbound-webhooks/${secretName}`;
}

function getSecretNameFromVaultPath(vaultPath: string): string {
  return vaultPath.split('/').filter(Boolean).at(-1) ?? vaultPath;
}

function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

async function writeTenantSecret(tenant: string, vaultPath: string, value: string): Promise<void> {
  const secretProvider = await getSecretProviderInstance();
  await secretProvider.setTenantSecret(tenant, getSecretNameFromVaultPath(vaultPath), value);
}

async function deleteTenantSecret(tenant: string, vaultPath: string): Promise<void> {
  if (!vaultPath) {
    return;
  }

  const secretProvider = await getSecretProviderInstance();
  await secretProvider.deleteTenantSecret(tenant, getSecretNameFromVaultPath(vaultPath));
}

async function deleteAuthSecretsForRow(row: InboundWebhookRow): Promise<void> {
  const config = row.auth_config ?? {};
  const vaultPath = String(
    config.secret_vault_path ??
      config.secretVaultPath ??
      config.token_vault_path ??
      config.tokenVaultPath ??
      '',
  );

  if (vaultPath) {
    await deleteTenantSecret(row.tenant, vaultPath);
  }
}

async function buildStoredAuthConfig(args: {
  tenant: string;
  inboundWebhookId: string;
  input: InboundWebhookUpsertInput;
  existing?: InboundWebhookRow | null;
}): Promise<{ authConfig: Record<string, unknown>; oneTimeSecret: string | null }> {
  const { tenant, inboundWebhookId, input, existing } = args;
  const existingAuthConfig = existing?.auth_config ?? {};
  const existingAuthType = existing?.auth_type;

  switch (input.auth_config.type) {
    case 'hmac_sha256': {
      const existingVaultPath =
        existingAuthType === 'hmac_sha256'
          ? String(existingAuthConfig.secret_vault_path ?? existingAuthConfig.secretVaultPath ?? '')
          : '';
      const secretVaultPath =
        input.auth_config.secret_vault_path ||
        existingVaultPath ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'hmac_secret'));
      const secret = input.auth_config.secret ?? (!existingVaultPath ? generateWebhookSecret() : null);

      if (secret) {
        await writeTenantSecret(tenant, secretVaultPath, secret);
      }

      return {
        authConfig: {
          type: 'hmac_sha256',
          signature_header: input.auth_config.signature_header,
          secret_vault_path: secretVaultPath,
        },
        oneTimeSecret: secret,
      };
    }
    case 'bearer': {
      const existingVaultPath =
        existingAuthType === 'bearer'
          ? String(existingAuthConfig.token_vault_path ?? existingAuthConfig.tokenVaultPath ?? '')
          : '';
      const tokenVaultPath =
        input.auth_config.token_vault_path ||
        existingVaultPath ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'bearer_token'));
      const token = input.auth_config.token ?? (!existingVaultPath ? generateWebhookSecret() : null);

      if (token) {
        await writeTenantSecret(tenant, tokenVaultPath, token);
      }

      return {
        authConfig: {
          type: 'bearer',
          token_vault_path: tokenVaultPath,
        },
        oneTimeSecret: token,
      };
    }
    case 'ip_allowlist':
      return {
        authConfig: {
          type: 'ip_allowlist',
          ip_cidrs: input.auth_config.ip_cidrs,
        },
        oneTimeSecret: null,
      };
    case 'path_token': {
      const existingVaultPath =
        existingAuthType === 'path_token'
          ? String(existingAuthConfig.token_vault_path ?? existingAuthConfig.tokenVaultPath ?? '')
          : '';
      const tokenVaultPath =
        input.auth_config.token_vault_path ||
        existingVaultPath ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'path_token'));
      const token = input.auth_config.token ?? (!existingVaultPath ? generateWebhookSecret() : null);

      if (token) {
        await writeTenantSecret(tenant, tokenVaultPath, token);
      }

      return {
        authConfig: {
          type: 'path_token',
          query_param: input.auth_config.query_param,
          token_vault_path: tokenVaultPath,
        },
        oneTimeSecret: token,
      };
    }
  }
}

function buildStoredHandlerConfig(input: InboundWebhookUpsertInput): Record<string, unknown> {
  if (input.handler_config.type === 'direct_action') {
    return {
      type: 'direct_action',
      action: input.handler_config.action,
      field_mapping: input.handler_config.field_mapping,
    };
  }

  return {
    type: 'workflow',
    workflow_id: input.handler_config.workflow_id,
  };
}

async function getInboundWebhookPermissionError(
  user: IUserWithRoles,
  action: 'create' | 'read' | 'update' | 'delete' | 'replay',
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
): Promise<ActionPermissionError | null> {
  if (await hasPermission(user, 'inbound_webhook', action, knex)) {
    return null;
  }

  return permissionError(`Permission denied: inbound_webhook:${action} permission required`);
}

export const listInboundWebhooks = withAuth(async (
  user,
  { tenant },
): Promise<InboundWebhookConfig[] | InboundWebhookServerActionError> => {
  const { knex } = await createTenantKnex(tenant);
  const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  const db = tenantDb(knex, tenant);
  const rows = await db.table<InboundWebhookRow>('inbound_webhooks')
    .orderBy('updated_at', 'desc')
    .orderBy('name', 'asc');

  const configs: InboundWebhookConfig[] = [];
  for (const row of rows) {
    const mapped = safeMapInboundWebhook(row);
    if ('actionError' in mapped) {
      return mapped as InboundWebhookServerActionError;
    }
    configs.push(mapped);
  }

  return configs;
});

export const listInboundWebhookActions = withAuth(async (
  user,
  { tenant },
): Promise<InboundActionDefinitionView[] | InboundWebhookServerActionError> => {
  const { knex } = await createTenantKnex(tenant);
  const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
  if (permissionFailure) {
    return permissionFailure;
  }
  await bootstrapInboundWebhookActions();

  return listActions().map((action) => ({
    name: action.name,
    entityType: action.entityType,
    displayName: action.displayName,
    description: action.description,
    targetFields: action.targetFields,
  }));
});

export const listInboundWorkflowOptions = withAuth(async (
  user,
  { tenant },
): Promise<InboundWorkflowOptionView[] | InboundWebhookServerActionError> => {
  const { knex } = await createTenantKnex(tenant);
  const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
  if (permissionFailure) {
    return permissionFailure;
  }

  if (!canUseInboundWebhookWorkflowHandlers()) {
    return [];
  }

  const db = tenantDb(knex, tenant);
  const publishedVersions = db.table('workflow_definition_versions')
    .select('tenant', 'workflow_id')
    .max('version as published_version')
    .groupBy('tenant', 'workflow_id')
    .as('published_versions');

  const workflowDefinitionsQuery = db.table('workflow_definitions as workflow_definitions');
  db.tenantJoinSubquery(
    workflowDefinitionsQuery,
    publishedVersions,
    'published_versions.workflow_id',
    'workflow_definitions.workflow_id',
    {
      type: 'left',
      rootTenantColumn: 'workflow_definitions.tenant',
      joinedTenantColumn: 'published_versions.tenant',
    }
  );

  const rows = await workflowDefinitionsQuery
    .select(
      'workflow_definitions.workflow_id',
      'workflow_definitions.name',
      'workflow_definitions.description',
      'workflow_definitions.status',
      knex.raw('published_versions.published_version as published_version'),
    )
    .where((query) => {
      query.whereNull('workflow_definitions.is_visible').orWhere('workflow_definitions.is_visible', true);
    })
    .orderBy('workflow_definitions.name', 'asc') as Array<{
      workflow_id: string;
      name: string;
      description: string | null;
      status: string | null;
      published_version: number | string | null;
    }>;

  return rows.map((row) => ({
    workflowId: row.workflow_id,
    name: row.name,
    description: row.description,
    status: row.status,
    publishedVersion: row.published_version == null ? null : Number(row.published_version),
  }));
});

export const getInboundWebhook = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
  ): Promise<InboundWebhookConfig | null | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const row = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({
        inbound_webhook_id: inboundWebhookId,
      })
      .first();

    return row ? safeMapInboundWebhook(row) : null;
  },
);

export const upsertInboundWebhook = withAuth(
  async (
    user,
    { tenant },
    input: unknown,
  ): Promise<{ webhook: InboundWebhookConfig; secret: string | null } | InboundWebhookServerActionError> => {
    const parsedInput = inboundWebhookUpsertInputSchema.safeParse(input);
    if (!parsedInput.success) {
      const firstIssue = parsedInput.error.issues[0];
      return actionError(firstIssue?.message ?? 'Check the inbound webhook settings and try again.');
    }

    const parsed = parsedInput.data;
    const { knex } = await createTenantKnex(tenant);
    const action = parsed.inbound_webhook_id ? 'update' : 'create';
    const permissionFailure = await getInboundWebhookPermissionError(user, action, knex);
    if (permissionFailure) {
      return permissionFailure;
    }
    if (parsed.handler_type === 'workflow' || parsed.handler_config.type === 'workflow') {
      if (!canUseInboundWebhookWorkflowHandlers()) {
        return actionError('Inbound webhook workflow handlers require Enterprise edition.');
      }
    }

    const db = tenantDb(knex, tenant);
    const existing = parsed.inbound_webhook_id
      ? await db.table<InboundWebhookRow>('inbound_webhooks')
          .where({ inbound_webhook_id: parsed.inbound_webhook_id })
          .first()
      : null;

    if (parsed.inbound_webhook_id && !existing) {
      return actionError('Inbound webhook not found.');
    }

    const slugCollision = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ slug: parsed.slug })
      .modify((query) => {
        if (parsed.inbound_webhook_id) {
          query.andWhereNot('inbound_webhook_id', parsed.inbound_webhook_id);
        }
      })
      .first('inbound_webhook_id');

    if (slugCollision) {
      return actionError(`Inbound webhook slug "${parsed.slug}" already exists.`);
    }

    const inboundWebhookId = parsed.inbound_webhook_id ?? crypto.randomUUID();
    const { authConfig, oneTimeSecret } = await buildStoredAuthConfig({
      tenant,
      inboundWebhookId,
      input: parsed,
      existing,
    });
    const handlerConfig = buildStoredHandlerConfig(parsed);

    const rowPayload = {
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description ?? null,
      auth_type: parsed.auth_type,
      auth_config: authConfig,
      idempotency_source: parsed.idempotency_source ?? null,
      idempotency_window_seconds: parsed.idempotency_window_seconds,
      handler_type: parsed.handler_type,
      handler_config: handlerConfig,
      is_active: parsed.is_active,
      rate_limit_per_minute: parsed.rate_limit_per_minute,
      updated_at: knex.fn.now(),
    };

    const [row] = parsed.inbound_webhook_id
      ? await db.table<InboundWebhookRow>('inbound_webhooks')
          .where({ inbound_webhook_id: inboundWebhookId })
          .update(rowPayload)
          .returning('*')
      : await db.table<InboundWebhookRow>('inbound_webhooks')
          .insert({
            tenant,
            inbound_webhook_id: inboundWebhookId,
            ...rowPayload,
            created_by: user.user_id,
            created_at: knex.fn.now(),
          })
          .returning('*');

    const mapped = safeMapInboundWebhook(row);
    if ('actionError' in mapped) {
      return mapped as InboundWebhookServerActionError;
    }

    return {
      webhook: mapped,
      secret: oneTimeSecret,
    };
  },
);

export const deleteInboundWebhook = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
  ): Promise<{ deleted: true; inboundWebhookId: string } | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'delete', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const existing = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .first();

    if (!existing) {
      return actionError('Inbound webhook not found.');
    }

    // Citus does not allow ON DELETE SET NULL when the distribution column is
    // part of the foreign key, so null out the link on delivery rows here
    // before the parent row is removed.
    await db.table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')
      .where({ inbound_webhook_id: inboundWebhookId })
      .update({ inbound_webhook_id: null });

    await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .delete();

    await deleteAuthSecretsForRow(existing);

    return { deleted: true, inboundWebhookId };
  },
);

export const rotateInboundWebhookSecret = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
  ): Promise<{ webhook: InboundWebhookConfig; secret: string } | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'update', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const existing = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .first();

    if (!existing) {
      return actionError('Inbound webhook not found.');
    }

    if (existing.auth_type === 'ip_allowlist') {
      return actionError('IP allowlist inbound webhooks do not have a secret to rotate.');
    }

    const authConfig = { ...(existing.auth_config ?? {}) };
    const secret = generateWebhookSecret();
    let vaultPath: string;

    if (existing.auth_type === 'hmac_sha256') {
      vaultPath =
        String(authConfig.secret_vault_path ?? authConfig.secretVaultPath ?? '') ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'hmac_secret'));
      authConfig.type = 'hmac_sha256';
      authConfig.secret_vault_path = vaultPath;
    } else if (existing.auth_type === 'bearer') {
      vaultPath =
        String(authConfig.token_vault_path ?? authConfig.tokenVaultPath ?? '') ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'bearer_token'));
      authConfig.type = 'bearer';
      authConfig.token_vault_path = vaultPath;
    } else if (existing.auth_type === 'path_token') {
      vaultPath =
        String(authConfig.token_vault_path ?? authConfig.tokenVaultPath ?? '') ||
        buildSecretVaultPath(buildSecretName(inboundWebhookId, 'path_token'));
      authConfig.type = 'path_token';
      authConfig.token_vault_path = vaultPath;
    } else {
      return actionError(`Unsupported inbound webhook auth type: ${existing.auth_type}.`);
    }

    await writeTenantSecret(tenant, vaultPath, secret);

    const [row] = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .update({
        auth_config: authConfig,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    const mapped = safeMapInboundWebhook(row);
    if ('actionError' in mapped) {
      return mapped as InboundWebhookServerActionError;
    }

    return {
      webhook: mapped,
      secret,
    };
  },
);

export const setInboundWebhookActiveState = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
    active: boolean,
  ): Promise<InboundWebhookConfig | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'update', knex);
    if (permissionFailure) {
      return permissionFailure;
    }
    const updatePayload: Record<string, unknown> = {
      is_active: active,
      updated_at: knex.fn.now(),
    };

    if (active) {
      updatePayload.auto_disabled_at = null;
    }

    const db = tenantDb(knex, tenant);
    const [row] = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .update(updatePayload)
      .returning('*');

    if (!row) {
      return actionError('Inbound webhook not found.');
    }

    return safeMapInboundWebhook(row);
  },
);

export const listInboundDeliveries = withAuth(
  async (
    user,
    { tenant },
    filter: ListInboundDeliveriesFilter = {},
    page: number = 1,
    limit: number = DEFAULT_DELIVERY_PAGE_SIZE,
  ): Promise<InboundDeliveryPage | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const safePage = Math.max(1, Math.floor(page || 1));
    const safeLimit = Math.min(MAX_DELIVERY_PAGE_SIZE, Math.max(1, Math.floor(limit || DEFAULT_DELIVERY_PAGE_SIZE)));

    const applyFilters = <TRecord extends {} = any, TResult = any>(
      query: Knex.QueryBuilder<TRecord, TResult>,
    ): Knex.QueryBuilder<TRecord, TResult> => {
      if (filter.inboundWebhookId) {
        query.andWhere('inbound_webhook_id', filter.inboundWebhookId);
      }

      if (filter.status) {
        query.andWhere('dispatch_status', filter.status);
      }

      if (filter.dateFrom) {
        query.andWhere('received_at', '>=', new Date(filter.dateFrom));
      }

      if (filter.dateTo) {
        query.andWhere('received_at', '<=', new Date(filter.dateTo));
      }

      return query;
    };

    const db = tenantDb(knex, tenant);
    const totalRow = await applyFilters(db.table('inbound_webhook_deliveries'))
      .count<{ count: string | number }[]>({ count: '*' })
      .first();

    const rows = await applyFilters(db.table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries'))
      .orderBy('received_at', 'desc')
      .limit(safeLimit)
      .offset((safePage - 1) * safeLimit);

    return {
      data: rows.map(mapInboundDelivery),
      page: safePage,
      limit: safeLimit,
      total: Number(totalRow?.count ?? 0),
    };
  },
);

export const getInboundDelivery = withAuth(
  async (
    user,
    { tenant },
    deliveryId: string,
  ): Promise<InboundWebhookDelivery | null | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'read', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const row = await db.table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')
      .where({ delivery_id: deliveryId })
      .first();

    return row ? mapInboundDelivery(row) : null;
  },
);

export const captureSamplePayload = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
  ): Promise<InboundWebhookConfig | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'update', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const captureExpiresAt = new Date(Date.now() + SAMPLE_CAPTURE_WINDOW_MS);
    const db = tenantDb(knex, tenant);
    const [row] = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .update({
        sample_capture_expires_at: captureExpiresAt,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    if (!row) {
      return actionError('Inbound webhook not found.');
    }

    return safeMapInboundWebhook(row);
  },
);

export const clearSamplePayload = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
  ): Promise<InboundWebhookConfig | InboundWebhookServerActionError> => {
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'update', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const [row] = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .update({
        sample_payload: null,
        sample_capture_expires_at: null,
        updated_at: knex.fn.now(),
      })
      .returning('*');

    if (!row) {
      return actionError('Inbound webhook not found.');
    }

    return safeMapInboundWebhook(row);
  },
);

async function fetchInboundDeliveryById(
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
  tenant: string,
  deliveryId: string,
): Promise<InboundWebhookDelivery> {
  const row = await tenantDb(knex, tenant).table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')
    .where({ delivery_id: deliveryId })
    .first();

  if (!row) {
    throw new Error('Inbound delivery not found');
  }

  return mapInboundDelivery(row);
}

async function dispatchAndRecordOutcome(args: {
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'];
  webhook: InboundWebhookRow;
  deliveryId: string;
  idempotencyKey: string | null;
  body: unknown;
  headers: Record<string, string | string[]>;
  startedAt: number;
}): Promise<void> {
  try {
    const outcome = await dispatchInboundWebhookHandler({
      webhook: mapWebhookRowToDispatchWebhook(args.webhook),
      deliveryId: args.deliveryId,
      idempotencyKey: args.idempotencyKey,
      body: args.body,
      headers: args.headers,
    });

    await updateInboundDeliveryOutcome(args.knex, {
      tenant: args.webhook.tenant,
      deliveryId: args.deliveryId,
      dispatchStatus: 'dispatched',
      handlerOutcome: outcome,
      responseStatus: 200,
      responseBody: { delivery_id: args.deliveryId },
      durationMs: Date.now() - args.startedAt,
    });
  } catch (error) {
    const handlerOutcome = inboundWebhookDispatchOutcomeFromError(error);
    await updateInboundDeliveryOutcome(args.knex, {
      tenant: args.webhook.tenant,
      deliveryId: args.deliveryId,
      dispatchStatus: 'failed',
      handlerOutcome,
      responseStatus: 500,
      responseBody: { delivery_id: args.deliveryId, error: 'dispatch_failed' },
      durationMs: Date.now() - args.startedAt,
    });
  }
}

export const replayInboundDelivery = withAuth(
  async (
    user,
    { tenant },
    deliveryId: string,
  ): Promise<InboundWebhookDelivery | InboundWebhookServerActionError> => {
    const startedAt = Date.now();
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'replay', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const original = await db.table<InboundWebhookDeliveryRow>('inbound_webhook_deliveries')
      .where({ delivery_id: deliveryId })
      .first();

    if (!original) {
      return actionError('Inbound delivery not found.');
    }

    if (!original.inbound_webhook_id) {
      return actionError('Cannot replay an inbound delivery without a webhook config.');
    }

    const webhook = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: original.inbound_webhook_id })
      .first();

    if (!webhook || !webhook.is_active) {
      return actionError('Inbound webhook not found or inactive.');
    }

    const { deliveryId: replayDeliveryId } = await createInboundDelivery(knex, {
      tenant,
      inboundWebhookId: webhook.inbound_webhook_id,
      idempotencyKey: original.idempotency_key,
      requestMethod: original.request_method,
      requestPath: original.request_path,
      requestHeaders: original.request_headers,
      requestBody: original.request_body,
      sourceIp: original.source_ip,
      userAgent: original.user_agent,
      authStatus: 'verified',
      isReplay: true,
      replayedFrom: original.delivery_id,
    });

    await dispatchAndRecordOutcome({
      knex,
      webhook,
      deliveryId: replayDeliveryId,
      idempotencyKey: original.idempotency_key,
      body: original.request_body,
      headers: original.request_headers,
      startedAt,
    });

    return fetchInboundDeliveryById(knex, tenant, replayDeliveryId);
  },
);

export const sendInboundWebhookTest = withAuth(
  async (
    user,
    { tenant },
    inboundWebhookId: string,
    input: SendInboundWebhookTestInput = {},
  ): Promise<InboundWebhookDelivery | InboundWebhookServerActionError> => {
    const startedAt = Date.now();
    const { knex } = await createTenantKnex(tenant);
    const permissionFailure = await getInboundWebhookPermissionError(user, 'update', knex);
    if (permissionFailure) {
      return permissionFailure;
    }

    const db = tenantDb(knex, tenant);
    const webhook = await db.table<InboundWebhookRow>('inbound_webhooks')
      .where({ inbound_webhook_id: inboundWebhookId })
      .first();

    if (!webhook || !webhook.is_active) {
      return actionError('Inbound webhook not found or inactive.');
    }

    const headers = Object.fromEntries(
      Object.entries(input.headers ?? {}).filter((entry): entry is [string, string | string[]] => entry[1] !== undefined),
    );
    const { deliveryId } = await createInboundDelivery(knex, {
      tenant,
      inboundWebhookId: webhook.inbound_webhook_id,
      requestMethod: 'POST',
      requestPath: `/api/inbound/test/${webhook.slug}`,
      requestHeaders: headers,
      requestBody: input.body ?? null,
      authStatus: 'verified',
    });

    await dispatchAndRecordOutcome({
      knex,
      webhook,
      deliveryId,
      idempotencyKey: null,
      body: input.body ?? null,
      headers,
      startedAt,
    });

    return fetchInboundDeliveryById(knex, tenant, deliveryId);
  },
);
