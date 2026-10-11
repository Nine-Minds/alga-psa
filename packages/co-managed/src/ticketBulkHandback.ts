import type { Knex } from 'knex';
import { isCoManagedLifecycleError, assertCoManagedOperationalWrite } from '@alga-psa/licensing';
import { handBackCoManagedTicket, CoManagedTicketHandoffError, type CoManagedTicketHandoffReceipt } from './ticketHandoffs';
import { CoManagedSharedWorkError, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, isCoManagedUuid, type CoManagedSessionActor } from './sharedWorkIdentity';
import { withCoManagedSharedWork, type CoManagedSharedResource } from './sharedWork';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

export interface CoManagedBulkHandbackRequest {
  note: string;
  items: Array<{ resource: CoManagedSharedResource; operationId: string; expectedRevision: number }>;
}
export type CoManagedBulkHandbackResult = { index: number } & (
  { ok: true; receipt: CoManagedTicketHandoffReceipt } |
  { ok: false; code: 'forbidden' | 'changed' | 'invalid' | 'readOnly' }
);

/** Independent canonical commands keep per-ticket authority, transactions and
 * retry receipts. A transport failure can safely retry the exact frozen batch;
 * unexpected failures are not reported as proof that nothing was committed. */
export async function bulkHandBackCoManagedTickets(db: Knex, inputActor: CoManagedSessionActor, supplied: CoManagedBulkHandbackRequest): Promise<CoManagedBulkHandbackResult[]> {
  const actor = snapshotCoManagedSessionActor(inputActor), input = structuredClone(supplied);
  if (!input || !Array.isArray(input.items) || !input.items.length || input.items.length > 100 || typeof input.note !== 'string' || !input.note.trim() || input.note.length > 10000 || input.note.includes('\0')) throw new CoManagedTicketHandoffError('INVALID_HANDOFF');
  const results: CoManagedBulkHandbackResult[] = [], operations = new Set<string>(), resources = new Set<string>();
  for (const [index, item] of input.items.entries()) {
    const resource = item?.resource;
    const key = resource ? `${resource.tenant}:${resource.relationshipId}:${resource.id}`.toLowerCase() : '';
    if (!resource || resource.kind !== 'ticket' || ![resource.tenant, resource.relationshipId, resource.id, item.operationId].every(isCoManagedUuid) || resource.tenant.toLowerCase() === actor.tenant.toLowerCase() || !Number.isSafeInteger(item.expectedRevision) || item.expectedRevision < 1 || item.expectedRevision >= 2147483647 || operations.has(item.operationId.toLowerCase()) || resources.has(key)) {
      results.push({ index, ok: false, code: 'invalid' }); continue;
    }
    operations.add(item.operationId.toLowerCase()); resources.add(key);
    try {
      const target: CoManagedSharedResource = { kind: 'ticket', tenant: resource.tenant.toLowerCase(), relationshipId: resource.relationshipId.toLowerCase(), id: resource.id.toLowerCase() };
      const receipt = await withCoManagedSharedWork(db, actor, target, 'update', write => withCoManagedSharedWork(write.trx, actor, target, 'read', async read => {
        if (isCoManagedReadFieldHidden([...write.redactedFields, ...read.redactedFields], ['work', 'co_management_ticket_work', 'responsibility', 'work_revision', 'revision', 'notes', 'comments', 'handoffs', 'co_management_ticket_handoffs', 'co_management_ticket_work.revision', 'co_management_ticket_work.responsibility'].flatMap(name => [name, `values.${name}`, `tickets.${name}`]))) throw new CoManagedSharedWorkError();
        const receipt = await handBackCoManagedTicket(write.trx, actor, target, { operationId: item.operationId, expectedRevision: item.expectedRevision, note: input.note });
        await assertCoManagedSessionUnexpired(write.trx, actor);
        await assertCoManagedOperationalWrite(write.trx, target.tenant);
        return receipt;
      }));
      results.push({ index, ok: true, receipt });
    } catch (error) {
      if (error instanceof CoManagedSharedWorkError) results.push({ index, ok: false, code: 'forbidden' });
      else if (isCoManagedLifecycleError(error)) results.push({ index, ok: false, code: 'readOnly' });
      else if (error instanceof CoManagedTicketHandoffError) results.push({ index, ok: false, code: error.code === 'INVALID_HANDOFF' ? 'invalid' : 'changed' });
      else throw error;
    }
  }
  return results;
}
