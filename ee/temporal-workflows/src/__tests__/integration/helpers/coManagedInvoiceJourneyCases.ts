import type { Knex } from 'knex';
import { expect, it } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;

/**
 * Journey: customer staff log 5 operational minutes, MSP staff log a 15 minute billable entry on the
 * same shared ticket. The MSP invoice bills the 15 minute MSP entry only; no operational row ever
 * appears on an invoice; effort is 5 customer + 15 MSP = 20 combined, each entry counted once.
 *
 * `withJourney` supplies a participating customer workspace + MSP workspace with a shared ticket and
 * these helpers: `f.logOperational(minutes)` (customer actor, no service_id), `f.logBillable(minutes)`
 * (MSP actor, `co_managed` work item, service_id), `f.approve(entryId)`, `f.generateInvoice()`
 * (the MSP `generateInvoiceForSelectionInputs` path), `f.effort()` (`getCoManagedEffortTotals`).
 */
export function registerCoManagedInvoiceJourneyTests(_getDb: () => Knex, withJourney: Fixture) {
  it('bills the 15 minute MSP entry, never the operational one, and reports 5 + 15 = 20 effort once per entry', async () => withJourney(async f => {
    const operational = await f.logOperational(5);
    const billable = await f.logBillable(15);
    expect(await f.customer.table('time_entries').where('entry_id', operational.entry_id).first())
      .toMatchObject({ billing_mode: 'operational', service_id: null, billable_duration: 0 });
    expect(await f.sponsor.table('time_entries').where('entry_id', billable.entry_id).first())
      .toMatchObject({ billing_mode: 'commercial', work_item_type: 'co_managed', billable_duration: 15 });

    await f.approve(billable.entry_id);
    const first = await f.generateInvoice();
    const second = await f.generateInvoice(); // retry: nothing new to bill
    expect(first).toHaveProperty('invoice_id');
    expect(second?.invoice_id ?? null).toBeNull();

    const invoices = await f.sponsor.table('invoices');
    expect(invoices).toHaveLength(1);
    const links = await f.sponsor.table('invoice_time_entries').where('invoice_id', invoices[0].invoice_id);
    expect(links.map((row: any) => row.entry_id)).toEqual([billable.entry_id]);
    // The operational row is in another tenant, never linked, never marked invoiced.
    expect(await f.sponsor.table('invoice_time_entries').where('entry_id', operational.entry_id)).toHaveLength(0);
    expect(await f.customer.table('time_entries').where('entry_id', operational.entry_id).first()).toMatchObject({ invoiced: false });
    expect(await f.customer.table('invoices')).toHaveLength(0);
    // The MSP invoice carries exactly one time line, for the 15 billable minutes (0.25 h); the 5 operational minutes add nothing.
    const lines = await f.sponsor.table('invoice_charges').where('invoice_id', invoices[0].invoice_id);
    expect(lines).toHaveLength(1);
    expect(Number(lines[0].quantity)).toBeCloseTo(0.25, 5);
    // Shared work snapshots as its retained source kind (the customer ticket), billed once for 15 minutes.
    expect(links[0].work_item_snapshot).toMatchObject({ workItemType: 'ticket', billedMinutes: 15 });

    const effort = await f.effort();
    expect(effort).toMatchObject({ customerMinutes: 5, mspMinutes: 15, combinedMinutes: 20 });
    // Per side and combined are stable after billing (invoicing does not change effort).
    expect(await f.effort()).toEqual(effort);
  }));
}
