import { ensureMiscellaneousService, createTenantKnex, tenantDb } from '@alga-psa/db';
import { featureFlags } from '@alga-psa/core/server';
import type { IUserWithRoles } from '@alga-psa/types';
import type { Knex } from 'knex';
import type { ExperimentalFeatures, TenantSettings } from './tenantSettingsActions';

if (typeof window !== 'undefined') {
  throw new Error('tenantSettings.server.ts can only be imported in a server runtime');
}

const AI_ASSISTANT_ACTIVATION_FLAG = 'ai-assistant-activation';
const DEFAULT_EXPERIMENTAL_FEATURES: ExperimentalFeatures = { aiAssistant: false };

const tenantSettingsQuery = (knex: Knex, tenant: string) => tenantDb(knex, tenant).table('tenant_settings');

export async function getTenantSettingsByTenantId(tenantId: string): Promise<TenantSettings | null> {
  if (!tenantId) throw new Error('tenantId is required');
  const { knex } = await createTenantKnex(tenantId);
  const settings = await tenantSettingsQuery(knex, tenantId).select('*').first();
  return (settings as TenantSettings | undefined) || null;
}

export async function getExperimentalFeaturesForTenant(
  tenant: string,
  user?: Pick<IUserWithRoles, 'user_id' | 'user_type'>,
): Promise<ExperimentalFeatures> {
  const settings = await getTenantSettingsByTenantId(tenant);
  const raw = settings?.settings?.experimentalFeatures;
  const features: ExperimentalFeatures = raw && typeof raw === 'object'
    ? { aiAssistant: (raw as Record<string, unknown>).aiAssistant === true }
    : { ...DEFAULT_EXPERIMENTAL_FEATURES };
  if (!(await featureFlags.isEnabled(AI_ASSISTANT_ACTIVATION_FLAG, {
    tenantId: tenant,
    userId: user?.user_id,
  }))) features.aiAssistant = false;
  return features;
}

export async function getTenantTimezone(tenantId: string): Promise<string | null> {
  const { knex } = await createTenantKnex(tenantId);
  const row = await tenantSettingsQuery(knex, tenantId).select('settings').first();
  let settings = row?.settings;
  if (typeof settings === 'string') {
    try { settings = JSON.parse(settings); } catch { settings = {}; }
  }
  const timezone = settings && typeof settings === 'object' ? settings.timezone : undefined;
  return typeof timezone === 'string' && timezone.length > 0 ? timezone : null;
}

export async function initializeTenantSettings(tenantId: string): Promise<void> {
  if (!tenantId) throw new Error('tenantId is required');
  try {
    const { knex } = await createTenantKnex(tenantId);
    await ensureMiscellaneousService(knex, tenantId);
    const now = new Date();
    await tenantSettingsQuery(knex, tenantId).insert({
      tenant: tenantId,
      onboarding_completed: false,
      onboarding_skipped: false,
      onboarding_data: null,
      settings: JSON.stringify({ experimentalFeatures: DEFAULT_EXPERIMENTAL_FEATURES }),
      created_at: now,
      updated_at: now,
    }).onConflict('tenant').ignore();
  } catch (error) {
    console.error('Error initializing tenant settings:', error);
    throw error;
  }
}
