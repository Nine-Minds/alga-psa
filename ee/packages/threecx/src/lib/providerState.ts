import crypto from 'node:crypto';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

export const THREECX_PROVIDER = '3cx';

export type ThreecxPbxStatus = 'not_configured' | 'connected' | 'error';

export interface ThreecxPbxCapabilities {
  xapi: boolean;
  callControl: boolean;
}

/** PBX API connection (3CX Enterprise/AI). The secret lives in the tenant secret provider. */
export interface ThreecxPbxConfig {
  baseUrl: string | null;
  clientId: string | null;
  clientSecretRef: string | null;
  status: ThreecxPbxStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  capabilities: ThreecxPbxCapabilities;
}

export interface ThreecxExtensionMapping {
  dn: string;
  pbxDisplayName: string;
  pbxEmail: string;
  userId: string | null;
  mappedBy: 'auto' | 'manual' | null;
}

export interface ThreecxCdrConfig {
  enabled: boolean;
  lookbackDays: number;
  watermark: string | null;
  lastRunAt: string | null;
  lastRunAdded: number;
}

export type ThreecxPhonebookSchedule = 'daily' | 'hourly';

export interface ThreecxPhonebookCounts {
  created: number;
  updated: number;
  deleted: number;
  imported: number;
  skipped: number;
}

export interface ThreecxPhonebookConfig {
  enabled: boolean;
  schedule: ThreecxPhonebookSchedule;
  lastPushAt: string | null;
  lastImportAt: string | null;
  lastPushCounts: ThreecxPhonebookCounts | null;
  lastImportCounts: ThreecxPhonebookCounts | null;
  lastError: string | null;
}

export interface ThreecxProviderConfig {
  templateVersion: number;
  keyRotatedAt: string | null;
  pbx: ThreecxPbxConfig;
  extensions: ThreecxExtensionMapping[];
  extensionsSyncedAt: string | null;
  cdr: ThreecxCdrConfig;
  phonebook: ThreecxPhonebookConfig;
}

/** What the settings card sees of the PBX connection: never the secret. */
export interface ThreecxPbxState extends Omit<ThreecxPbxConfig, 'clientSecretRef'> {
  hasClientSecret: boolean;
}

export interface ThreecxProviderState {
  provider: string;
  status: 'not_configured' | 'active' | 'disabled' | 'error';
  autoCreateTickets: boolean;
  keyLastFour: string | null;
  keyRotatedAt: string | null;
  templateVersion: number;
  pbx: ThreecxPbxState;
  extensions: ThreecxExtensionMapping[];
  extensionsSyncedAt: string | null;
  cdr: ThreecxCdrConfig;
  phonebook: ThreecxPhonebookConfig;
}

/** The current template contract version stamped on downloads. */
export const THREECX_TEMPLATE_VERSION = 2;

export const THREECX_DEFAULT_CDR_LOOKBACK_DAYS = 30;

/** 32 random bytes, base64url, no padding — 43 characters. */
export function generateThreecxApiKey(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function defaultThreecxPbxConfig(): ThreecxPbxConfig {
  return {
    baseUrl: null,
    clientId: null,
    clientSecretRef: null,
    status: 'not_configured',
    lastCheckedAt: null,
    lastError: null,
    capabilities: { xapi: false, callControl: false },
  };
}

export function defaultThreecxCdrConfig(): ThreecxCdrConfig {
  return {
    enabled: false,
    lookbackDays: THREECX_DEFAULT_CDR_LOOKBACK_DAYS,
    watermark: null,
    lastRunAt: null,
    lastRunAdded: 0,
  };
}

export function defaultThreecxPhonebookConfig(): ThreecxPhonebookConfig {
  return {
    enabled: false,
    schedule: 'daily',
    lastPushAt: null,
    lastImportAt: null,
    lastPushCounts: null,
    lastImportCounts: null,
    lastError: null,
  };
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown): boolean {
  return value === true;
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parsePbx(raw: unknown): ThreecxPbxConfig {
  const value = obj(raw);
  const caps = obj(value.capabilities);
  const status = value.status;
  return {
    baseUrl: str(value.baseUrl),
    clientId: str(value.clientId),
    clientSecretRef: str(value.clientSecretRef),
    status: status === 'connected' || status === 'error' ? status : 'not_configured',
    lastCheckedAt: str(value.lastCheckedAt),
    lastError: str(value.lastError),
    capabilities: { xapi: bool(caps.xapi), callControl: bool(caps.callControl) },
  };
}

function parseExtensions(raw: unknown): ThreecxExtensionMapping[] {
  if (!Array.isArray(raw)) return [];
  const out: ThreecxExtensionMapping[] = [];
  for (const item of raw) {
    const value = obj(item);
    const dn = str(value.dn)?.trim();
    if (!dn) continue;
    const mappedBy = value.mappedBy === 'auto' || value.mappedBy === 'manual' ? value.mappedBy : null;
    out.push({
      dn,
      pbxDisplayName: str(value.pbxDisplayName) ?? '',
      pbxEmail: str(value.pbxEmail) ?? '',
      userId: str(value.userId),
      mappedBy: value.userId ? mappedBy : null,
    });
  }
  return out;
}

function parseCdr(raw: unknown): ThreecxCdrConfig {
  const value = obj(raw);
  const lookback = Math.floor(num(value.lookbackDays, THREECX_DEFAULT_CDR_LOOKBACK_DAYS));
  return {
    enabled: bool(value.enabled),
    lookbackDays: lookback > 0 ? lookback : THREECX_DEFAULT_CDR_LOOKBACK_DAYS,
    watermark: str(value.watermark),
    lastRunAt: str(value.lastRunAt),
    lastRunAdded: Math.max(0, Math.floor(num(value.lastRunAdded, 0))),
  };
}

function parseCounts(raw: unknown): ThreecxPhonebookCounts | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = obj(raw);
  return {
    created: num(value.created, 0),
    updated: num(value.updated, 0),
    deleted: num(value.deleted, 0),
    imported: num(value.imported, 0),
    skipped: num(value.skipped, 0),
  };
}

function parsePhonebook(raw: unknown): ThreecxPhonebookConfig {
  const value = obj(raw);
  return {
    enabled: bool(value.enabled),
    schedule: value.schedule === 'hourly' ? 'hourly' : 'daily',
    lastPushAt: str(value.lastPushAt),
    lastImportAt: str(value.lastImportAt),
    lastPushCounts: parseCounts(value.lastPushCounts),
    lastImportCounts: parseCounts(value.lastImportCounts),
    lastError: str(value.lastError),
  };
}

/**
 * Tolerant config read: a row whose `config` is malformed, hand-edited, or
 * written by an older build reads as defaults for every missing section
 * instead of throwing, so the settings surface never breaks on a bad row.
 */
export function parseThreecxConfig(raw: unknown): ThreecxProviderConfig {
  const value = typeof raw === 'string' ? safeJsonParse(raw) : obj(raw);

  return {
    templateVersion: num(value.templateVersion, 0),
    keyRotatedAt: str(value.keyRotatedAt),
    pbx: parsePbx(value.pbx),
    extensions: parseExtensions(value.extensions),
    extensionsSyncedAt: str(value.extensionsSyncedAt),
    cdr: parseCdr(value.cdr),
    phonebook: parsePhonebook(value.phonebook),
  };
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

export function toThreecxPbxState(pbx: ThreecxPbxConfig): ThreecxPbxState {
  const { clientSecretRef, ...rest } = pbx;
  return { ...rest, hasClientSecret: Boolean(clientSecretRef) };
}

function toState(row: any): ThreecxProviderState {
  const config = parseThreecxConfig(row?.config);
  return {
    provider: THREECX_PROVIDER,
    status: row ? ((row.status as ThreecxProviderState['status']) ?? 'not_configured') : 'not_configured',
    autoCreateTickets: Boolean(row?.auto_create_tickets),
    keyLastFour: keyLastFour(row?.webhook_secret),
    keyRotatedAt: config.keyRotatedAt,
    templateVersion: config.templateVersion,
    pbx: toThreecxPbxState(config.pbx),
    extensions: config.extensions,
    extensionsSyncedAt: config.extensionsSyncedAt,
    cdr: config.cdr,
    phonebook: config.phonebook,
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

/** Parsed config for the tenant's 3cx row, or null when there is no row. */
export async function getThreecxProviderConfig(
  tenantId: string,
  knex?: any,
): Promise<{ row: any; config: ThreecxProviderConfig } | null> {
  const conn = knex ?? (await createTenantKnex(tenantId)).knex;
  const row = await readRow(conn, tenantId);
  if (!row) return null;
  return { row, config: parseThreecxConfig(row.config) };
}

/**
 * Read-modify-write on the 3cx row's config. Every writer goes through here
 * so no section can be dropped by a writer that only knows about its own keys.
 */
export async function updateThreecxConfig(
  tenantId: string,
  mutate: (config: ThreecxProviderConfig) => ThreecxProviderConfig | void,
  knex?: any,
): Promise<ThreecxProviderConfig> {
  const conn = knex ?? (await createTenantKnex(tenantId)).knex;
  const existing = await readRow(conn, tenantId);
  if (!existing) {
    throw new Error('The 3CX provider is not configured for this tenant.');
  }
  const current = parseThreecxConfig(existing.config);
  const next = mutate(current) ?? current;
  await tenantDb(conn, tenantId)
    .table('telephony_providers')
    .where({ provider_id: existing.provider_id })
    .update({ config: JSON.stringify(next), updated_at: conn.fn.now() });
  return next;
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
    const config = parseThreecxConfig({});
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
  const nextConfig: ThreecxProviderConfig = {
    ...parseThreecxConfig(existing.config),
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
  const existing = await readRow(knex, tenantId);
  if (!existing) return;
  await updateThreecxConfig(tenantId, (config) => ({ ...config, templateVersion }), knex);
}
