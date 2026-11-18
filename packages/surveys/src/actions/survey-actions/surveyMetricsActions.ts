'use server';

import type { SurveyDashboardFilters, SurveyDashboardMetrics } from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import SurveyAnalyticsService from '../../services/SurveyAnalyticsService';
import { assertPsaOnlyTenantAccess } from '@shared/services/productAccessGuard';

export const getSurveyMetrics = withAuth(async (
  user,
  { tenant },
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardMetrics> => {
  await assertPsaOnlyTenantAccess({ tenantId: tenant, userId: user.user_id }, 'survey_actions');
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getDashboardMetrics(knex, tenant, filters);
});
