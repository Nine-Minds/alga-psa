'use server';

import type { Knex } from 'knex';

import {
  type SurveyDashboardData,
  type SurveyDashboardFilters,
  type SurveyClientSatisfactionSummary,
  type SurveyTicketSatisfactionSummary,
} from '../interfaces/survey.interface';
import { SurveyAnalyticsService } from './SurveyAnalyticsService';

export class SurveyDashboardService {
  static async getDashboardData(
    knex: Knex,
    tenantId: string,
    filters?: SurveyDashboardFilters
  ): Promise<SurveyDashboardData> {
    const metrics = await SurveyAnalyticsService.getDashboardMetrics(knex, tenantId, filters);
    const [trend, distribution, topIssues, recentResponses] = await Promise.all([
      SurveyAnalyticsService.getResponseTrend(knex, tenantId, filters),
      SurveyAnalyticsService.getRatingDistribution(knex, tenantId, metrics.totalResponses, filters),
      SurveyAnalyticsService.getTopNegativeResponses(knex, tenantId, filters),
      SurveyAnalyticsService.getRecentResponses(knex, tenantId, filters),
    ]);

    return {
      metrics,
      trend,
      distribution,
      topIssues,
      recentResponses,
    };
  }

  static async getClientSummary(
    knex: Knex,
    tenantId: string,
    clientId: string
  ): Promise<SurveyClientSatisfactionSummary | null> {
    return SurveyAnalyticsService.getClientSummary(knex, tenantId, clientId);
  }

  static async getTicketSummary(
    knex: Knex,
    tenantId: string,
    ticketId: string
  ): Promise<SurveyTicketSatisfactionSummary | null> {
    return SurveyAnalyticsService.getTicketSummary(knex, tenantId, ticketId);
  }
}
