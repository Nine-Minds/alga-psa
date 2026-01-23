'use server';

import type { SurveyDashboardFilters, SurveyDashboardMetrics } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import SurveyAnalyticsService from '../../services/SurveyAnalyticsService';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to access survey metrics');
  }
  return tenant;
}

export async function getSurveyMetrics(
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardMetrics> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyAnalyticsService.getDashboardMetrics(knex, tenantId, filters);
}
