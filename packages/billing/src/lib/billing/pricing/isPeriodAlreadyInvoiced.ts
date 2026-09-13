import type { Knex } from "knex";
import { tenantDb } from "@alga-psa/db";
import { buildPostDropRecurringObligationCandidates } from "@alga-psa/shared/billingClients/postDropRecurringObligationIdentity";

export interface InvoicedPeriod {
  start: string;
  end: string;
}

/**
 * Has a recurring service period overlapping `[period.start, period.end)` for
 * this contract line already been linked to an invoice?
 *
 * One shared helper so the rollout preview and the engine's existing
 * already-billed guards (`recurring_service_periods.invoice_id`) cannot
 * disagree about what is already on an invoice. The engine additionally checks
 * `invoice_charge_details`; this mirrors the recurring-period signal, which is
 * authoritative for materialized service periods.
 */
export async function isPeriodAlreadyInvoiced(
  trx: Knex | Knex.Transaction,
  tenant: string,
  contractLineId: string,
  period: InvoicedPeriod,
): Promise<boolean> {
  if (!contractLineId || !period?.start || !period?.end) {
    return false;
  }

  const candidates = buildPostDropRecurringObligationCandidates({
    contractLineId,
    chargeFamily: "fixed",
  });

  const row = await tenantDb(trx, tenant)
    .table("recurring_service_periods")
    .whereNotNull("invoice_id")
    .where("service_period_start", "<", period.end)
    .where("service_period_end", ">=", period.start)
    .where(function matchObligationCandidates(this: Knex.QueryBuilder) {
      for (const [index, candidate] of candidates.entries()) {
        const match = function matchCandidate(this: Knex.QueryBuilder) {
          this.where("obligation_type", candidate.obligationType).andWhere(
            "obligation_id",
            candidate.obligationId,
          );
        };
        if (index === 0) {
          this.where(match);
        } else {
          this.orWhere(match);
        }
      }
    })
    .first();

  return Boolean(row);
}
