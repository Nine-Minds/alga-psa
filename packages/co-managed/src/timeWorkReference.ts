import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { CoManagedSharedWorkError, isCoManagedUuid } from './sharedWorkIdentity';

export type CoManagedWorkSourceKind = 'ticket' | 'project_task';

/** The MSP-local routing row an MSP time entry's `work_item_id` points at. */
export interface CoManagedLocalWorkReference {
  localReferenceId: string;
  customerTenant: string;
  relationshipId: string;
  sourceKind: CoManagedWorkSourceKind;
  sourceId: string;
  clientId: string;
}

/** Resolve the MSP-local routing row for qualified shared work (read-only, in the MSP's own tenant). */
export async function findCoManagedLocalWorkReference(db: Knex, tenant: string,
  source: { customerTenant: string; relationshipId: string; kind: CoManagedWorkSourceKind; id: string }): Promise<CoManagedLocalWorkReference | null> {
  const home = tenantDb(db, tenant);
  const ticket = source.kind === 'ticket';
  const row = await home.table(ticket ? 'co_managed_ticket_references' : 'co_managed_project_task_references')
    .where({ customer_tenant: source.customerTenant, relationship_id: source.relationshipId, [ticket ? 'ticket_id' : 'task_id']: source.id })
    .first('reference_id', 'client_id');
  return row ? { localReferenceId: row.reference_id, customerTenant: source.customerTenant, relationshipId: source.relationshipId,
    sourceKind: source.kind, sourceId: source.id, clientId: row.client_id } : null;
}

/** Find a routing row by the id time entries store in `work_item_id`. Ticket and task tables are disjoint uuid spaces. */
export async function loadCoManagedLocalWorkReference(db: Knex, tenant: string, localReferenceId: string): Promise<(CoManagedLocalWorkReference & { billingProfileId: string | null }) | null> {
  if (!isCoManagedUuid(localReferenceId)) return null;
  const home = tenantDb(db, tenant);
  const ticket = await home.table('co_managed_ticket_references').where('reference_id', localReferenceId)
    .first('customer_tenant', 'relationship_id', 'ticket_id', 'client_id', 'billing_profile_id');
  if (ticket) return { localReferenceId, customerTenant: ticket.customer_tenant, relationshipId: ticket.relationship_id, sourceKind: 'ticket',
    sourceId: ticket.ticket_id, clientId: ticket.client_id, billingProfileId: ticket.billing_profile_id ?? null };
  const task = await home.table('co_managed_project_task_references').where('reference_id', localReferenceId)
    .first('customer_tenant', 'relationship_id', 'task_id', 'client_id', 'billing_profile_id');
  return task ? { localReferenceId, customerTenant: task.customer_tenant, relationshipId: task.relationship_id, sourceKind: 'project_task',
    sourceId: task.task_id, clientId: task.client_id, billingProfileId: task.billing_profile_id ?? null } : null;
}

/**
 * One provenance row per MSP entry, keyed on `(tenant, entry_id)`. The captured title/ticket number
 * are the descriptive evidence admitted when the entry was written; they are never a live read path
 * (a later field revocation does not leak through this row). Idempotent per entry.
 */
export async function recordCoManagedWorkReference(trx: Knex.Transaction, tenant: string, entryId: string,
  reference: CoManagedLocalWorkReference, evidence: { title?: string | null; ticketNumber?: string | null } = {}): Promise<void> {
  if (!trx.isTransaction || reference.customerTenant === tenant) throw new CoManagedSharedWorkError();
  // write-admission: exempt — provenance row written in the same transaction as the admitted shared time save
  await tenantDb(trx, tenant).table('co_managed_time_work_references').insert({
    tenant, entry_id: entryId, customer_tenant: reference.customerTenant, relationship_id: reference.relationshipId,
    source_kind: reference.sourceKind, source_id: reference.sourceId, local_reference_id: reference.localReferenceId, client_id: reference.clientId,
    ticket_number: evidence.ticketNumber ?? null, title: evidence.title ?? null,
  }).onConflict(['tenant', 'entry_id']).ignore();
}
