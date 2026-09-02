import crypto from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

export const THREECX_PROVIDER = '3cx';

export interface ThreecxProviderConfig {
  templateVersion: number;
  keyRotatedAt: string | null;
}

export interface ThreecxProviderState {
  provider: string;
  status: 'not_configured' | 'active' | 'disabled' | 'error';
  autoCreateTickets: boolean;
  keyLastFour: string | null;
  keyRotatedAt: string | null;
  templateVersion: number;
}

/** The current template contract version stamped on downloads. */
export const THREECX_TEMPLATE_VERSION = 1;

/** 32 random bytes, base64url, no padding — 43 characters. */
export function generateThreecxApiKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Tolerant config read: a row whose `config` is malformed (or an older shape)
 * reads as templateVersion 0 / keyRotatedAt null instead of throwing, so a
 * hand-edited row never breaks the settings surface.
 */
export function parseThreecxConfig(raw: unknown): ThreecxProviderConfig {
  const value =
    typeof raw === 'string'
      ? safeJsonParse(raw)
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>)
        : {};

  const templateVersion =
    value && typeof (value as any).templateVersion === 'number' && Number.isFinite((value as any).templateVersion)
      ? (value as any).templateVersion
      : 0;
  const keyRotatedAt =
    value && typeof (value as any).keyRotatedAt === 'string' ? (value as any).keyRotatedAt : null;

  return { templateVersion, keyRotatedAt };
}

function safeJsonParse(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function keyLastFour(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.slice(-4);
}

function toState(row: any): ThreecxProviderState {
  if (!row) {
    return {
      provider: THREECX_PROVIDER,
      status: 'not_configured',
      autoCreateTickets: false,
      keyLastFour: null,
      keyRotatedAt: null,
      templateVersion: 0,
    };
  }
  const config = parseThreecxConfig(row.config);
  return {
    provider: THREECX_PROVIDER,
    status: (row.status as ThreecxProviderState['status']) ?? 'not_configured',
    autoCreateTickets: Boolean(row.auto_create_tickets),
    keyLastFour: keyLastFour(row.webhook_secret),
    keyRotatedAt: config.keyRotatedAt,
    templateVersion: config.templateVersion,
  };
}

async function readRow(knex: any, tenantId: string): Promise<any> {
  return tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider: THREECX_PROVIDER })
    .first();
}

export async function getThreecxProviderState(tenantId: string): Promise<ThreecxProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  return toState(await readRow(knex, tenantId));
}

export interface ThreecxActivationResult extends ThreecxProviderState {
  /** The full key, present only on the call that generated it. */
  apiKey: string | null;
}

export async function activateThreecxProvider(tenantId: string): Promise<ThreecxActivationResult> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const existing = await readRow(knex, tenantId);

  let generatedKey: string | null = null;

  if (existing) {
    const patch: Record<string, unknown> = {
      status: 'active',
      last_error: null,
      updated_at: knex.fn.now(),
    };
    if (!existing.webhook_secret) {
      generatedKey = generateThreecxApiKey();
      patch.webhook_secret = generatedKey;
    }
    await db
      .table('telephony_providers')
      .where({ provider_id: existing.provider_id })
      .update(patch);
  } else {
    generatedKey = generateThreecxApiKey();
    const config: ThreecxProviderConfig = { templateVersion: 0, keyRotatedAt: null };
    await db.table('telephony_providers').insert({
      tenant: tenantId,
      provider: THREECX_PROVIDER,
      status: 'active',
      webhook_secret: generatedKey,
      config: JSON.stringify(config),
      created_at: knex.fn.now(),
      updated_at: knex.fn.now(),
    } as any);
  }

  const state = toState(await readRow(knex, tenantId));
  return { ...state, apiKey: generatedKey };
}

export async function deactivateThreecxProvider(tenantId: string): Promise<ThreecxProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  await tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider: THREECX_PROVIDER })
    .update({ status: 'disabled', updated_at: knex.fn.now() });

  return getThreecxProviderState(tenantId);
}

export interface ThreecxRotationResult extends ThreecxProviderState {
  apiKey: string;
}

export async function rotateThreecxApiKey(tenantId: string): Promise<ThreecxRotationResult> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const existing = await readRow(knex, tenantId);
  if (!existing) {
    throw new Error('Cannot rotate the 3CX API key before the provider is configured.');
  }

  const apiKey = generateThreecxApiKey();
  const config = parseThreecxConfig(existing.config);
  const nextConfig: ThreecxProviderConfig = {
    templateVersion: config.templateVersion,
    keyRotatedAt: new Date().toISOString(),
  };

  await db
    .table('telephony_providers')
    .where({ provider_id: existing.provider_id })
    .update({
      webhook_secret: apiKey,
      config: JSON.stringify(nextConfig),
      updated_at: knex.fn.now(),
    });

  const state = toState(await readRow(knex, tenantId));
  return { ...state, apiKey };
}

export async function setThreecxAutoCreateTickets(
  tenantId: string,
  autoCreateTickets: boolean,
): Promise<ThreecxProviderState> {
  const { knex } = await createTenantKnex(tenantId);
  await tenantDb(knex, tenantId)
    .table('telephony_providers')
    .where({ provider: THREECX_PROVIDER })
    .update({ auto_create_tickets: autoCreateTickets, updated_at: knex.fn.now() });

  return getThreecxProviderState(tenantId);
}

/** Stamps the config.templateVersion after a template download. */
export async function stampThreecxTemplateVersion(
  tenantId: string,
  templateVersion: number,
): Promise<void> {
  const { knex } = await createTenantKnex(tenantId);
  const db = tenantDb(knex, tenantId);
  const existing = await readRow(knex, tenantId);
  if (!existing) return;
  const config = parseThreecxConfig(existing.config);
  const nextConfig: ThreecxProviderConfig = {
    templateVersion,
    keyRotatedAt: config.keyRotatedAt,
  };
  await db
    .table('telephony_providers')
    .where({ provider_id: existing.provider_id })
    .update({ config: JSON.stringify(nextConfig), updated_at: knex.fn.now() });
}
