import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';

/** A cycle bridges an invoice to its calendar; it must not choose who is billed. */
export async function findRecurringInvoiceBillingCycle(
  knex: Knex | Knex.Transaction,
  tenant: string,
  input: {
    clientId: string;
    windowStart: string;
    windowEnd: string;
    billingProfileId: string;
    isDefaultProfile: boolean;
  },
): Promise<string | null> {
  const cycles = await tenantDb(knex, tenant).table('client_billing_cycles')
    .where({
      client_id: input.clientId,
      period_start_date: input.windowStart,
      period_end_date: input.windowEnd,
    })
    .orderBy('billing_cycle_id', 'asc')
    .select('billing_cycle_id', 'billing_profile_id');
  // Prefer the profile's own cycle. Pre-profile calendars may have a null
  // profile, but only the client's default invoice may use that legacy bridge.
  return cycles.find((cycle) => cycle.billing_profile_id === input.billingProfileId)?.billing_cycle_id
    ?? (input.isDefaultProfile
      ? cycles.find((cycle) => cycle.billing_profile_id == null)?.billing_cycle_id
      : null)
    ?? null;
}
