'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { hasPermission, withAuth } from '@alga-psa/auth';
import type { IOpportunitySettings } from '@alga-psa/types';
import { opportunitySettingsSchema } from '../schemas/opportunitySchemas';
import { getOpportunitySettings, updateOpportunitySettingsModel } from '../models/opportunitySettingsModel';

export const readOpportunitySettings = withAuth(async (user, { tenant }): Promise<IOpportunitySettings> => {
  if (!await hasPermission(user as any, 'opportunities', 'read')) {
    throw new Error('Permission denied: opportunities read required');
  }
  const { knex } = await createTenantKnex();
  return getOpportunitySettings(knex, tenant);
});

export const writeOpportunitySettings = withAuth(async (
  user,
  { tenant },
  input: unknown,
): Promise<IOpportunitySettings> => {
  if (!await hasPermission(user as any, 'opportunities', 'update')) {
    throw new Error('Permission denied: opportunities update required');
  }
  const data = opportunitySettingsSchema.parse(input);
  const { knex } = await createTenantKnex();
  const current = await getOpportunitySettings(knex, tenant);
  const assessmentServiceIds = data.assessment_service_ids ?? current.assessment_service_ids;
  if (assessmentServiceIds.length > 0) {
    const rows = await tenantDb(knex, tenant).table('service_catalog')
      .whereIn('service_id', assessmentServiceIds)
      .select('service_id');
    if (rows.length !== new Set(assessmentServiceIds).size) {
      throw new Error('One or more assessment services were not found');
    }
  }
  return updateOpportunitySettingsModel(knex, tenant, {
    ...data,
    assessment_service_ids: assessmentServiceIds,
  } as Pick<
    IOpportunitySettings,
    'nudge_days' | 'interrupt_days' | 'escalation_mode' | 'renewal_lead_days' | 'tm_threshold_cents' | 'asset_age_years' | 'assessment_service_ids'
  >);
});
