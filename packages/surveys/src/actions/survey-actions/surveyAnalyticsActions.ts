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
import SurveyAnalyticsService from 'server/src/services/SurveyAnalyticsService';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to access survey analytics');
  }
  return tenant;
}

export async function getSurveyResponseTrend(
  filters?: SurveyDashboardFilters
): Promise<SurveyTrendPoint[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyAnalyticsService.getResponseTrend(knex, tenantId, filters);
}

export async function getSurveyRatingDistribution(
  filters?: SurveyDashboardFilters
): Promise<SurveyDistributionBucket[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  const totalResponses = await SurveyAnalyticsService.getDashboardMetrics(
    knex,
    tenantId,
    filters
  );
  return SurveyAnalyticsService.getRatingDistribution(
    knex,
    tenantId,
    totalResponses.totalResponses,
    filters
  );
}

export async function getSurveyTopIssues(
  filters?: SurveyDashboardFilters,
  limit = 5
): Promise<SurveyIssueSummary[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyAnalyticsService.getTopNegativeResponses(knex, tenantId, filters, limit);
}

export async function getSurveyRecentResponses(
  filters?: SurveyDashboardFilters,
  limit = 10
): Promise<SurveyResponseListItem[]> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyAnalyticsService.getRecentResponses(knex, tenantId, filters, limit);
}

export async function getSurveyResponsesPage(params?: {
  filters?: SurveyDashboardFilters;
  page?: number;
  pageSize?: number;
}): Promise<SurveyResponsePage> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyAnalyticsService.getResponsesPage(knex, tenantId, params);
}
