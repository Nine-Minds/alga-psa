'use server';

import {
  type SurveyDashboardFilters,
  type SurveyDistributionBucket,
  type SurveyIssueSummary,
  type SurveyResponseListItem,
  type SurveyTrendPoint,
  type SurveyResponsePage,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import SurveyAnalyticsService from '../../services/SurveyAnalyticsService';

export const getSurveyResponseTrend = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters
): Promise<SurveyTrendPoint[]> => {
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getResponseTrend(knex, tenant, filters);
});

export const getSurveyRatingDistribution = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters
): Promise<SurveyDistributionBucket[]> => {
  const { knex } = await createTenantKnex();
  const totalResponses = await SurveyAnalyticsService.getDashboardMetrics(
    knex,
    tenant,
    filters
  );
  return SurveyAnalyticsService.getRatingDistribution(
    knex,
    tenant,
    totalResponses.totalResponses,
    filters
  );
});

export const getSurveyTopIssues = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters,
  limit: number = 5
): Promise<SurveyIssueSummary[]> => {
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getTopNegativeResponses(knex, tenant, filters, limit);
});

export const getSurveyRecentResponses = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters,
  limit: number = 10
): Promise<SurveyResponseListItem[]> => {
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getRecentResponses(knex, tenant, filters, limit);
});

export const getSurveyResponsesPage = withAuth(async (
  _user,
  { tenant },
  params?: {
    filters?: SurveyDashboardFilters;
    page?: number;
    pageSize?: number;
  }
): Promise<SurveyResponsePage> => {
  const { knex } = await createTenantKnex();
  return SurveyAnalyticsService.getResponsesPage(knex, tenant, params);
});
