import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IOpportunitySettings } from '@alga-psa/types';

export const DEFAULT_OPPORTUNITY_SETTINGS = {
  nudge_days: 14,
  interrupt_days: 21,
  escalation_mode: 'solo' as const,
  renewal_lead_days: 120,
  tm_threshold_cents: 120000,
  asset_age_years: 6,
  assessment_service_ids: [] as string[],
};

function normalize(row: Record<string, unknown>): IOpportunitySettings {
  return {
    tenant: String(row.tenant),
    nudge_days: Number(row.nudge_days),
    interrupt_days: Number(row.interrupt_days),
    escalation_mode: row.escalation_mode as IOpportunitySettings['escalation_mode'],
    renewal_lead_days: Number(row.renewal_lead_days),
    tm_threshold_cents: Number(row.tm_threshold_cents),
    asset_age_years: Number(row.asset_age_years),
    assessment_service_ids: Array.isArray(row.assessment_service_ids)
      ? row.assessment_service_ids.map(String)
      : [],
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function getOpportunitySettings(
  conn: Knex | Knex.Transaction,
  tenant: string,
): Promise<IOpportunitySettings> {
  const db = tenantDb(conn, tenant);
  let row = await db.table('opportunity_settings').first();
  if (!row) {
    [row] = await db.table('opportunity_settings')
      .insert({ tenant, ...DEFAULT_OPPORTUNITY_SETTINGS })
      .onConflict('tenant')
      .ignore()
      .returning('*');
    row ??= await db.table('opportunity_settings').first();
  }
  if (!row) throw new Error('Unable to initialize opportunity settings');
  return normalize(row);
}

export async function updateOpportunitySettingsModel(
  conn: Knex | Knex.Transaction,
  tenant: string,
  patch: Pick<IOpportunitySettings,
    | 'nudge_days'
    | 'interrupt_days'
    | 'escalation_mode'
    | 'renewal_lead_days'
    | 'tm_threshold_cents'
    | 'asset_age_years'
    | 'assessment_service_ids'
  >,
): Promise<IOpportunitySettings> {
  const [row] = await tenantDb(conn, tenant).table('opportunity_settings')
    .insert({ tenant, ...patch, updated_at: new Date().toISOString() })
    .onConflict('tenant')
    .merge({ ...patch, updated_at: new Date().toISOString() })
    .returning('*');
  return normalize(row);
}
