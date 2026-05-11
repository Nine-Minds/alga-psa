'use server';

import { withAuth } from '@alga-psa/auth/withAuth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex } from '@alga-psa/db';
import type { IUserWithRoles } from '@alga-psa/types';

import type {
  InboundWebhookAuthConfig,
  InboundWebhookConfig,
  InboundWebhookHandlerConfig,
  InboundWebhookIdempotencySource,
} from '@/lib/inboundWebhooks/types';

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
      throw new Error(`Unsupported inbound webhook auth type: ${authType}`);
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

  throw new Error(`Unsupported inbound webhook handler type: ${handlerType}`);
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

async function assertInboundWebhookPermission(
  user: IUserWithRoles,
  action: 'create' | 'read' | 'update' | 'delete' | 'replay',
  knex: Awaited<ReturnType<typeof createTenantKnex>>['knex'],
): Promise<void> {
  if (!(await hasPermission(user, 'inbound_webhook', action, knex))) {
    throw new Error(`Forbidden: inbound_webhook:${action} permission required`);
  }
}

export const listInboundWebhooks = withAuth(async (user, { tenant }): Promise<InboundWebhookConfig[]> => {
  const { knex } = await createTenantKnex(tenant);
  await assertInboundWebhookPermission(user, 'read', knex);

  const rows = await knex<InboundWebhookRow>('inbound_webhooks')
    .where({ tenant })
    .orderBy('updated_at', 'desc')
    .orderBy('name', 'asc');

  return rows.map(mapInboundWebhook);
});
