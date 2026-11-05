import 'server-only';

import { createTenantKnex, tenantDb } from '@alga-psa/db';

function normalizeSettingsRecord(value: unknown): Record<string, any> {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

/** Server-only persistence boundary for tenant settings. Callers must authorize
 * and validate their typed operation before using the merge primitive. */
export async function readTenantSettingsRow(tenant: string): Promise<any | null> {
  const { knex } = await createTenantKnex(tenant);
  return (await tenantDb(knex, tenant).table('tenant_settings').select('*').first()) ?? null;
}

export async function readTenantSettingsJson(tenant: string): Promise<Record<string, any>> {
  const { knex } = await createTenantKnex(tenant);
  const row = await tenantDb(knex, tenant).table('tenant_settings').select('settings').first();
  return normalizeSettingsRecord(row?.settings);
}

/** Public portal configuration only. Never select onboarding columns or return
 * the complete settings bag from a portal-facing code path. */
export async function readTenantPortalSettings(tenant: string): Promise<{
  branding: unknown;
  defaultLocale: unknown;
  clientPortalDefaultLocale: unknown;
  theme: unknown;
} | null> {
  const { knex } = await createTenantKnex(tenant);
  const row = await tenantDb(knex, tenant).table('tenant_settings').select('settings').first();
  const settings = normalizeSettingsRecord(row?.settings);
  return {
    branding: settings.branding,
    defaultLocale: settings.defaultLocale,
    clientPortalDefaultLocale: settings.clientPortal?.defaultLocale,
    theme: settings.theme,
  };
}

export async function getTenantTimezone(tenant: string): Promise<string | null> {
  const settings = await readTenantSettingsJson(tenant);
  return typeof settings.timezone === 'string' && settings.timezone.length > 0 ? settings.timezone : null;
}

export async function mergeTenantSettingsJson(tenant: string, patch: Record<string, unknown>): Promise<void> {
  const { knex } = await createTenantKnex(tenant);
  const db = tenantDb(knex, tenant);
  const row = await db.table('tenant_settings').select('settings').first();
  const current = normalizeSettingsRecord(row?.settings);
  const settings = { ...current, ...patch };
  const now = new Date();
  await db.table('tenant_settings').insert({ tenant, settings: JSON.stringify(settings), updated_at: now })
    .onConflict('tenant').merge({ settings: JSON.stringify(settings), updated_at: now });
}
