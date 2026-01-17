'use server';

import {
  type SurveyDashboardData,
  type SurveyDashboardFilters,
  type SurveyTicketSatisfactionSummary,
  type SurveyClientSatisfactionSummary,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import SurveyDashboardService from 'server/src/services/SurveyDashboardService';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to access survey dashboard data');
  }
  return tenant;
}

export async function getSurveyDashboardData(
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardData> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getDashboardData(knex, tenantId, filters);
}

export async function getSurveyClientSummary(
  clientId: string
): Promise<SurveyClientSatisfactionSummary | null> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getClientSummary(knex, tenantId, clientId);
}

export async function getSurveyTicketSummary(
  ticketId: string
): Promise<SurveyTicketSatisfactionSummary | null> {
  const { knex, tenant } = await createTenantKnex();
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getTicketSummary(knex, tenantId, ticketId);
}
