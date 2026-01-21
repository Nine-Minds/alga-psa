'use server';

import {
  type SurveyDashboardData,
  type SurveyDashboardFilters,
  type SurveyTicketSatisfactionSummary,
  type SurveyClientSatisfactionSummary,
} from '@alga-psa/types';
import { createTenantKnex } from '@alga-psa/db';
import { getCurrentUser } from '@alga-psa/auth/getCurrentUser';
import SurveyDashboardService from '../../services/SurveyDashboardService';

function ensureTenant(tenant: string | null): string {
  if (!tenant) {
    throw new Error('Tenant context is required to access survey dashboard data');
  }
  return tenant;
}

export async function getSurveyDashboardData(
  filters?: SurveyDashboardFilters
): Promise<SurveyDashboardData> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('Tenant context is required to access survey dashboard data');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getDashboardData(knex, tenantId, filters);
}

export async function getSurveyClientSummary(
  clientId: string
): Promise<SurveyClientSatisfactionSummary | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('Tenant context is required to access survey dashboard data');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getClientSummary(knex, tenantId, clientId);
}

export async function getSurveyTicketSummary(
  ticketId: string
): Promise<SurveyTicketSatisfactionSummary | null> {
  const currentUser = await getCurrentUser();
  if (!currentUser?.tenant) {
    throw new Error('Tenant context is required to access survey dashboard data');
  }

  const { knex, tenant } = await createTenantKnex(currentUser.tenant);
  const tenantId = ensureTenant(tenant);
  return SurveyDashboardService.getTicketSummary(knex, tenantId, ticketId);
}
