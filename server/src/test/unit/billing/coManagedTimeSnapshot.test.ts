import { expect, it } from 'vitest';
import { buildTimeEntryWorkItemSnapshot } from '../../../../../packages/billing/src/lib/billing/compute/computeTimeBasedCharges';
const billed = { billedMinutes: 60, rate: 10000, netAmount: 10000, serviceId: 'local-service', serviceName: 'MSP effort' };
it.each(['ticket', 'project_task'])('preserves qualified %s provenance while billing only MSP effort', kind => {
  const snapshot = buildTimeEntryWorkItemSnapshot({ start_time: new Date('2026-09-08T09:00:00Z'), work_item_id: 'local-reference', work_item_type: 'co_managed',
    work_source_tenant: 'customer', work_source_kind: kind, work_source_id: 'source-id', work_relationship_id: 'relationship',
    ticket_number: '42', ticket_title: 'Retained ticket', ticket_description: 'Public description', project_task_name: 'Retained task' }, billed);
  expect(snapshot).toMatchObject({ workItemType: kind, workItemId: 'source-id', sourceTenant: 'customer', relationshipId: 'relationship', workReferenceId: 'local-reference',
    title: kind === 'ticket' ? 'Retained ticket' : 'Retained task', ticketNumber: kind === 'ticket' ? '42' : null, billedMinutes: 60, netAmount: 10000 });
});
it('refuses shared invoice snapshots with missing qualified source identity', () => {
  expect(() => buildTimeEntryWorkItemSnapshot({ start_time: new Date(), work_item_id: 'reference', work_item_type: 'co_managed' }, billed)).toThrow('qualified retained source');
});
