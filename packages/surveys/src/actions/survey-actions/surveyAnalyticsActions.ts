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
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import SurveyAnalyticsService from '../../services/SurveyAnalyticsService';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to access survey analytics');
  }
  return tenant;
}

async function getTenantDbContext() {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('Tenant context is required to access survey analytics');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  return { knex, tenantId: ensureTenant(tenant) };
}

export async function getSurveyResponseTrend(
  filters?: SurveyDashboardFilters
): Promise<SurveyTrendPoint[]> {
  const { knex, tenantId } = await getTenantDbContext();
  return SurveyAnalyticsService.getResponseTrend(knex, tenantId, filters);
}

export async function getSurveyRatingDistribution(
  filters?: SurveyDashboardFilters
): Promise<SurveyDistributionBucket[]> {
  const { knex, tenantId } = await getTenantDbContext();
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
  const { knex, tenantId } = await getTenantDbContext();
  return SurveyAnalyticsService.getTopNegativeResponses(knex, tenantId, filters, limit);
}

export async function getSurveyRecentResponses(
  filters?: SurveyDashboardFilters,
  limit = 10
): Promise<SurveyResponseListItem[]> {
  const { knex, tenantId } = await getTenantDbContext();
  return SurveyAnalyticsService.getRecentResponses(knex, tenantId, filters, limit);
}

export async function getSurveyResponsesPage(params?: {
  filters?: SurveyDashboardFilters;
  page?: number;
  pageSize?: number;
}): Promise<SurveyResponsePage> {
  const { knex, tenantId } = await getTenantDbContext();
  return SurveyAnalyticsService.getResponsesPage(knex, tenantId, params);
}
