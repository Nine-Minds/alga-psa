import type { TenantSelector } from '@alga-psa/jobs/fanout';
import { getTenantTimezone } from '@alga-psa/tenancy/actions';
import { getTenantDefaultLocale } from '@alga-psa/notifications/notifications/emailLocaleResolver';
import {
  generateRecurringTicketsForTenant,
  type GenerateRecurringTicketsSummary,
} from '@alga-psa/tickets/lib/recurring/generateRecurringTicketsForTenant';
import { runWithTenant } from 'server/src/lib/db';
import { getConnection } from 'server/src/lib/db/db';

export const GENERATE_RECURRING_TICKETS_JOB = 'generate-recurring-tickets';
export const GENERATE_RECURRING_TICKETS_CRON = '*/15 * * * *';

export interface GenerateRecurringTicketsJobData extends Record<string, unknown> {
  tenantId: string;
}

// Ticket creation time is wall-clock in the tenant's timezone. A tenant that never set one is
// treated as UTC, the same default the rest of the platform applies to an unset tenant timezone.
const DEFAULT_TENANT_TIMEZONE = 'UTC';

export async function generateRecurringTicketsHandler(
  data: GenerateRecurringTicketsJobData
): Promise<GenerateRecurringTicketsSummary> {
  if (!data.tenantId) {
    throw new Error('Tenant ID is required for recurring ticket generation');
  }

  return runWithTenant(data.tenantId, async () => {
    const knex = await getConnection(data.tenantId);
    const [timeZone, locale] = await Promise.all([
      getTenantTimezone(data.tenantId),
      getTenantDefaultLocale(data.tenantId, 'internal'),
    ]);
    return generateRecurringTicketsForTenant(knex, data.tenantId, {
      timeZone: timeZone ?? DEFAULT_TENANT_TIMEZONE,
      locale,
    });
  });
}

/** Tenants with at least one active, unarchived definition: the EE fan-out only wakes these. */
export const tenantsWithActiveRecurringTickets: TenantSelector = (db) => db
  .unscoped<{ tenant: string }>('recurring_ticket_definitions', 'maintenance fanout narrows recurring-ticket generation to tenants with an active definition')
  .where({ is_active: true })
  .whereNull('archived_at')
  .distinct('tenant');
