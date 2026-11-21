import { describe, expect, it } from 'vitest';
import { buildTimeEntryWorkItemSnapshot } from '../../../../../packages/billing/src/lib/billing/compute/computeTimeBasedCharges';
import { isValidInvoiceTimeSnapshot } from '../../../../../packages/billing/src/lib/billing/invoiceTimeSnapshot';

// R1 (CM L6a2): the invoice snapshot whitelist accepts [null, 'ticket', 'project_task', 'ad_hoc']. A co-managed
// (MSP billable) entry carries work_item_type 'co_managed'; this proves the existing builder maps it to a value
// the validator accepts, so no billing file has to change for the invoice to be valid.
const billed = { billedMinutes: 15, rateKind: 'uniform' as const, uniformRate: 10000, rate: 10000, netAmount: 2500, serviceId: 'svc', serviceName: 'Remote support' };
const entry = (work_item_type: string) => ({ start_time: new Date('2026-10-20T09:00:00Z'), work_item_id: 'local-reference', work_item_type,
  ticket_number: null, ticket_title: null, ticket_description: null, project_task_name: null }) as any;

describe('co-managed time invoice snapshot (R1)', () => {
  it('snapshots a co_managed entry as a valid ad_hoc line without copying the foreign work-item type', () => {
    const snapshot = buildTimeEntryWorkItemSnapshot(entry('co_managed'), billed);
    expect(snapshot.workItemType).toBe('ad_hoc');
    expect(snapshot.billedMinutes).toBe(15);
    expect(isValidInvoiceTimeSnapshot(snapshot)).toBe(true);
  });
  it('never leaks the shared ticket into the frozen snapshot', () => {
    const snapshot = buildTimeEntryWorkItemSnapshot(entry('co_managed'), billed);
    expect(snapshot.ticketNumber ?? null).toBeNull();
    expect(snapshot.title ?? null).toBeNull();
  });
  it('leaves native ticket snapshots unchanged', () => {
    const snapshot = buildTimeEntryWorkItemSnapshot({ ...entry('ticket'), ticket_number: 'T-1', ticket_title: 'Printer' }, billed);
    expect(snapshot.workItemType).toBe('ticket');
    expect(isValidInvoiceTimeSnapshot(snapshot)).toBe(true);
  });
  it('rejects a snapshot that copied the raw co_managed type, which is why the builder must keep mapping it', () => {
    expect(isValidInvoiceTimeSnapshot({ ...buildTimeEntryWorkItemSnapshot(entry('co_managed'), billed), workItemType: 'co_managed' })).toBe(false);
  });
});
