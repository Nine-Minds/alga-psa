import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { toISODate, toPlainDate } from '@alga-psa/core';

interface RecurringInvoiceBillingCycleInput {
  clientId: string;
  windowStart: string;
  windowEnd: string;
  billingProfileId: string;
  isDefaultProfile: boolean;
}

function selectProfileCycle(
  cycles: Array<{ billing_cycle_id: string; billing_profile_id: string | null }>,
  input: RecurringInvoiceBillingCycleInput,
): string | null {
  // Prefer the profile's own cycle. Pre-profile calendars may have a null
  // profile, but only the client's default invoice may use that legacy bridge.
  return cycles.find((cycle) => cycle.billing_profile_id === input.billingProfileId)?.billing_cycle_id
    ?? (input.isDefaultProfile
      ? cycles.find((cycle) => cycle.billing_profile_id == null)?.billing_cycle_id
      : null)
    ?? null;
}

/** A cycle bridges an invoice to its calendar; it must not choose who is billed. */
export async function findRecurringInvoiceBillingCycle(
  knex: Knex | Knex.Transaction,
  tenant: string,
  input: RecurringInvoiceBillingCycleInput,
): Promise<string | null> {
  const cycles = await tenantDb(knex, tenant).table('client_billing_cycles')
    .where({
      client_id: input.clientId,
      period_start_date: input.windowStart,
      period_end_date: input.windowEnd,
    })
    .orderBy('billing_cycle_id', 'asc')
    .select('billing_cycle_id', 'billing_profile_id');
  return selectProfileCycle(cycles, input);
}

/** Resolve an entire due-work page without a query for each billing window. */
export async function findRecurringInvoiceBillingCycles(
  knex: Knex | Knex.Transaction,
  tenant: string,
  inputs: RecurringInvoiceBillingCycleInput[],
): Promise<Array<string | null>> {
  if (inputs.length === 0) return [];
  const windowKey = (clientId: string, start: string | Date, end: string | Date) =>
    JSON.stringify([clientId, toISODate(toPlainDate(start)), toISODate(toPlainDate(end))]);
  const windows = new Map(inputs.map((input) => [
    windowKey(input.clientId, input.windowStart, input.windowEnd), input,
  ]));
  const cycles = await tenantDb(knex, tenant).table('client_billing_cycles')
    .where((query) => {
      for (const input of windows.values()) {
        query.orWhere({
          client_id: input.clientId,
          period_start_date: input.windowStart,
          period_end_date: input.windowEnd,
        });
      }
    })
    .orderBy('billing_cycle_id', 'asc')
    .select('billing_cycle_id', 'billing_profile_id', 'client_id', 'period_start_date', 'period_end_date');
  const byWindow = new Map<string, typeof cycles>();
  for (const cycle of cycles) {
    const key = windowKey(cycle.client_id, cycle.period_start_date, cycle.period_end_date);
    const matching = byWindow.get(key) ?? [];
    matching.push(cycle);
    byWindow.set(key, matching);
  }
  return inputs.map((input) => {
    const matching = byWindow.get(windowKey(input.clientId, input.windowStart, input.windowEnd)) ?? [];
    return selectProfileCycle(matching, input);
  });
}
