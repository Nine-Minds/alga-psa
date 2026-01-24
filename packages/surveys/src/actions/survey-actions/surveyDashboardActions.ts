'use server';

import {
  type SurveyDashboardData,
  type SurveyDashboardFilters,
  type SurveyTicketSatisfactionSummary,
  type SurveyClientSatisfactionSummary,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import SurveyDashboardService from '../../services/SurveyDashboardService';

export const getSurveyDashboardData = withAuth(async (
  _user,
  { tenant },
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardData> => {
  const { knex } = await createTenantKnex();
  return SurveyDashboardService.getDashboardData(knex, tenant, filters);
});

export const getSurveyClientSummary = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<SurveyClientSatisfactionSummary | null> => {
  const { knex } = await createTenantKnex();
  return SurveyDashboardService.getClientSummary(knex, tenant, clientId);
});

export const getSurveyTicketSummary = withAuth(async (
  _user,
  { tenant },
  ticketId: string
): Promise<SurveyTicketSatisfactionSummary | null> => {
  const { knex } = await createTenantKnex();
  return SurveyDashboardService.getTicketSummary(knex, tenant, ticketId);
});
