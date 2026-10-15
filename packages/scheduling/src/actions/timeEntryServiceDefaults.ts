'use server';

import { createTenantKnex, tenantDb } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import { getEligibleContractLines } from '../lib/contractLineDisambiguation';
import {
  resolveDefaultTimeEntryService,
  type ResolvedDefaultTimeEntryService,
} from '../lib/timeEntryServiceDefaults';
import {
  timeSheetActionErrorFrom,
  type TimeSheetActionError,
} from './timeSheetActionErrors';

interface ResolveDefaultTicketTimeEntryServiceParams {
  /** Explicit client scope; when omitted it is resolved from the ticket. */
  clientId?: string;
  /** Ticket id used to resolve the client when `clientId` is not supplied. */
  workItemId?: string;
  workItemType?: string;
  /** Entry date used for contract eligibility; defaults to now. */
  effectiveDate?: string | Date;
}

/**
 * Resolve the default service for a new ticket time entry.
 *
 * Cascade: client `client_billing_settings.default_time_entry_service_id` first,
 * then tenant `default_billing_settings.default_time_entry_service_id`. A
 * candidate is only used when it still exists in the service catalog as an
 * active hourly service and is applicable to the client under the existing
 * contract-line eligibility rules. When nothing validates, `serviceId` is null
 * and the caller leaves the entry's service empty (unchanged required-field
 * behavior).
 */
export const resolveDefaultTicketTimeEntryService = withAuth(async (
  user,
  { tenant },
  params: ResolveDefaultTicketTimeEntryServiceParams
): Promise<ResolvedDefaultTimeEntryService | TimeSheetActionError> => {
  try {
    const { knex } = await createTenantKnex();
    const scopedDb = tenantDb(knex, tenant) as any;

    if (!await hasPermission(user, 'time_entry', 'read', knex)) {
      throw new Error('Permission denied: Cannot read default time entry service');
    }

    let clientId = params?.clientId ?? null;
    if (!clientId && params?.workItemId && params?.workItemType === 'ticket') {
      const ticket = await scopedDb.table('tickets')
        .where({ ticket_id: params.workItemId })
        .first('client_id');
      clientId = ticket?.client_id ?? null;
    }
    if (!clientId) {
      return { serviceId: null, source: null };
    }

    const [clientSettings, tenantSettings] = await Promise.all([
      scopedDb.table('client_billing_settings')
        .where({ client_id: clientId })
        .first('default_time_entry_service_id'),
      scopedDb.table('default_billing_settings')
        .first('default_time_entry_service_id'),
    ]);

    return await resolveDefaultTimeEntryService({
      clientDefaultServiceId: clientSettings?.default_time_entry_service_id ?? null,
      tenantDefaultServiceId: tenantSettings?.default_time_entry_service_id ?? null,
      validate: async (serviceId) => {
        // Same source the time-entry selector uses: an hourly service item.
        const service = await scopedDb.table('service_catalog')
          .where({
            service_id: serviceId,
            item_kind: 'service',
            billing_method: 'hourly',
            is_active: true,
          })
          .first('service_id');
        if (!service) {
          return false;
        }

        const eligibleContractLines = await getEligibleContractLines(
          knex,
          tenant,
          clientId,
          serviceId,
          params.effectiveDate
        );
        return eligibleContractLines.length > 0;
      },
    });
  } catch (error) {
    const expected = timeSheetActionErrorFrom(error);
    if (expected) return expected;
    throw error;
  }
});
