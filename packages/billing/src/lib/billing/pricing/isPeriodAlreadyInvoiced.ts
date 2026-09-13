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
 * One shared helper so the rollout preview and the engine's already-billed
 * guards cannot disagree about what is already billed (plan §3.1 bucket 4).
 * All three engine signals are mirrored here:
 *
 *   1. `recurring_service_periods.invoice_id` — materialized recurring service
 *      periods already linked to an invoice (the fixed/recurring signal).
 *   2. `invoice_charge_details` joined to the line's configuration — persisted
 *      per-service-period charges (`billingEngine.hasExistingServicePeriodCharge`).
 *   3. A client billing cycle overlapping `[period.start, period.end)` that
 *      already has an invoice (`billingEngine.hasExistingInvoiceForCycle`).
 *
 * The recurring-period signal alone is sufficient for materialized periods, but
 * a line billed before periods were materialized has only signal 2, and a
 * cycle-level invoice with no per-line detail has only signal 3. Checking all
 * three is what keeps the dialog from promising to change an already-invoiced
 * period.
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

  const db = tenantDb(trx, tenant);

  const candidates = buildPostDropRecurringObligationCandidates({
    contractLineId,
    chargeFamily: "fixed",
  });

  const recurringRow = await db
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

  if (recurringRow) {
    return true;
  }

  // Signal 2: persisted invoice charge detail for a service period overlapping
  // the target period. Mirrors `billingEngine.hasExistingServicePeriodCharge`,
  // widened from exact-match to overlap because the rollout preview works in
  // calendar periods rather than persisted service-period rows.
  const chargeDetailQuery = db.table("invoice_charge_details as iid");
  db.tenantJoin(
    chargeDetailQuery,
    "contract_line_service_configuration as clsc",
    "iid.config_id",
    "clsc.config_id",
  );
  const chargeDetail = await chargeDetailQuery
    .where("clsc.contract_line_id", contractLineId)
    .where("iid.service_period_start", "<", period.end)
    .where("iid.service_period_end", ">", period.start)
    .first("iid.item_detail_id");

  if (chargeDetail) {
    return true;
  }

  // Signal 3: a client billing cycle overlapping the period already has an
  // invoice. Mirrors `billingEngine.hasExistingInvoiceForCycle`, scoped to the
  // line's contract/client because the preview has a period, not a cycle id.
  const cycleInvoice = await db
    .table("invoices as i")
    .join("client_billing_cycles as cbc", function joinCycle() {
      this.on("cbc.billing_cycle_id", "=", "i.billing_cycle_id").andOn(
        "cbc.tenant",
        "=",
        "i.tenant",
      );
    })
    .join("client_contracts as cc", function joinAssignment() {
      this.on("cc.client_id", "=", "i.client_id").andOn("cc.tenant", "=", "i.tenant");
    })
    .join("contract_lines as cl", function joinLine() {
      this.on("cl.contract_id", "=", "cc.contract_id").andOn("cl.tenant", "=", "cc.tenant");
    })
    .where("i.tenant", tenant)
    .where("cl.contract_line_id", contractLineId)
    .where("cbc.period_start_date", "<", period.end)
    .where("cbc.period_end_date", ">", period.start)
    .first("i.invoice_id");

  return Boolean(cycleInvoice);
}
