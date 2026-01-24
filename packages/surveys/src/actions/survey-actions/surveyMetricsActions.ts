'use server';

import type { SurveyDashboardFilters, SurveyDashboardMetrics } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import SurveyAnalyticsService from '../../services/SurveyAnalyticsService';

export const getSurveyMetrics = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardMetrics> => {
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getDashboardMetrics(knex, tenant, filters);
});
