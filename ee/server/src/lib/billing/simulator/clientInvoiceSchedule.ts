import type { Knex } from "knex";
import type { ScenarioBillingSchedule } from "@alga-psa/types";
import { toISODate, toPlainDate } from "@alga-psa/core";
import {
  getClientBillingCycleAnchor,
  loadClientBillingCycleHistory,
} from "@alga-psa/shared/billingClients/billingSchedule";

/**
 * The invoice schedule a scenario simulates a client on: the client's current
 * cycle and anchor, plus the billed cycle windows (billed recurring service periods, merged with client_billing_cycles)
 * that were billed before any cycle change. Both scenario builders (saved
 * contract snapshot and unsaved draft) resolve cadence here, so a window the
 * client was billed under an older cycle keeps that cycle's boundaries and
 * prepaid-block windows line up with what the engine issued.
 */
export async function loadClientInvoiceSchedule(
  knex: Knex,
  tenant: string,
  clientId: string,
): Promise<ScenarioBillingSchedule> {
  const [schedule, history] = await Promise.all([
    getClientBillingCycleAnchor(knex, tenant, clientId),
    loadClientBillingCycleHistory(knex, tenant, clientId),
  ]);
  return {
    billing_cycle: schedule.billingCycle,
    anchor: {
      day_of_month: schedule.anchor.dayOfMonth,
      month_of_year: schedule.anchor.monthOfYear,
      day_of_week: schedule.anchor.dayOfWeek,
      reference_date: schedule.anchor.referenceDate,
    },
    history: history.map((cycle) => ({
      start_date: toISODate(toPlainDate(cycle.start)),
      end_date: toISODate(toPlainDate(cycle.end)),
    })),
  };
}
