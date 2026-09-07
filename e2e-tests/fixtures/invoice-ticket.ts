import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { createInvoiceTicketSourceFixture } from '../../server/test-utils/invoiceTicketProductionFixtures';
import { buildRecurringServicePeriodPeriodKey, buildRecurringServicePeriodScheduleKey } from '../../shared/billingClients/recurringServicePeriodKeys';

/** Seed due source periods without loading server actions into standalone Playwright. */
export async function createBrowserInvoiceTicketSourceFixture(db: Knex, identity: { tenant: string; userId: string }) {
  const ids = await createInvoiceTicketSourceFixture(db, identity, undefined, { materializeServicePeriods: false });
  await db.transaction(async (tx) => {
    for (const [lineId, chargeFamily] of [[ids.lineId, 'hourly'], [ids.usageLineId, 'usage']] as const) {
      await tx('recurring_service_periods').insert({
        tenant: identity.tenant, record_id: randomUUID(),
        schedule_key: buildRecurringServicePeriodScheduleKey({ tenant: identity.tenant,
          obligationType: 'client_contract_line', obligationId: lineId, cadenceOwner: 'client', duePosition: 'arrears' }),
        period_key: buildRecurringServicePeriodPeriodKey({ start: '2026-08-01', end: '2026-09-01' }),
        revision: 1, obligation_id: lineId, obligation_type: 'client_contract_line', charge_family: chargeFamily,
        cadence_owner: 'client', due_position: 'arrears', lifecycle_state: 'generated',
        service_period_start: '2026-08-01T00:00:00Z', service_period_end: '2026-09-01T00:00:00Z',
        invoice_window_start: '2026-09-01T00:00:00Z', invoice_window_end: '2026-10-01T00:00:00Z',
        provenance_kind: 'generated', source_rule_version: 'client_schedule|monthly|dom:1|moy:none|dow:none|ref:none',
        reason_code: 'backfill_materialization', source_run_key: `browser-invoice-ticket:${ids.clientId}`,
      });
    }
  });
  return ids;
}
