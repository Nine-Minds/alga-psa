import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { withCoManagedSharedWork, type CoManagedSessionActor, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError } from './sharedWorkIdentity';

/** Customer people and organisations are shown by name only. Their IDs are not
 * disclosed because they would never open a local record through this read. */
export interface CoManagedNamedReference { name: string | null }
export interface CoManagedSharedTicketDetails {
  resource: CoManagedSharedResource;
  revision: number;
  /** A key is present only when the sponsor's home policy discloses it; a
   * disclosed but empty value is `null`. Nothing is ever padded. */
  fields: {
    description?: string | null;
    requester?: CoManagedNamedReference | null;
    client?: CoManagedNamedReference | null;
    category?: { id: string; name: string | null } | null;
    due_date?: string | null;
    customer_assignee?: CoManagedNamedReference | null;
  };
}

/** Each key lists the canonical source names that also hide it. */
const sources: Record<keyof CoManagedSharedTicketDetails['fields'], string[]> = {
  description: ['description', 'attributes', 'tickets.attributes', 'tickets.description'],
  requester: ['requester', 'contact', 'contacts', 'contact_name', 'contact_name_id', 'tickets.contact_name_id'],
  client: ['client', 'clients', 'client_id', 'client_name', 'tickets.client_id'],
  category: ['category', 'categories', 'category_id', 'category_name', 'tickets.category_id'],
  due_date: ['due_date', 'tickets.due_date'],
  customer_assignee: ['customer_assignee', 'assignee', 'assigned_to', 'assigned_to_name', 'tickets.assigned_to', 'users'],
};
const visible = (context: CoManagedSharedWorkContext, key: keyof typeof sources) =>
  !isCoManagedReadFieldHidden(context.redactedFields, [key, ...sources[key]]);

async function readDetails(context: CoManagedSharedWorkContext): Promise<CoManagedSharedTicketDetails> {
  const { trx, resource, revision } = context;
  if (resource.kind !== 'ticket') throw new CoManagedSharedWorkError();
  const owner = tenantDb(trx, resource.tenant);
  const query = owner.table('tickets').where('tickets.ticket_id', resource.id);
  owner.tenantJoin(query, 'contacts', 'tickets.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
  owner.tenantJoin(query, 'clients', 'tickets.client_id', 'clients.client_id', { type: 'left' });
  owner.tenantJoin(query, 'categories', 'tickets.category_id', 'categories.category_id', { type: 'left' });
  owner.tenantJoin(query, 'users', 'tickets.assigned_to', 'users.user_id', { type: 'left' });
  const row = await query.first('tickets.attributes', 'tickets.due_date', 'tickets.contact_name_id', 'contacts.full_name as contact_name',
    'tickets.client_id', 'clients.client_name', 'tickets.category_id', 'categories.category_name', 'tickets.assigned_to',
    'users.first_name as assignee_first_name', 'users.last_name as assignee_last_name');
  if (!row) throw new CoManagedSharedWorkError();
  const fields: CoManagedSharedTicketDetails['fields'] = {};
  if (visible(context, 'description')) {
    const description = row.attributes && typeof row.attributes === 'object' ? (row.attributes as Record<string, unknown>).description : null;
    fields.description = typeof description === 'string' ? description : null;
  }
  if (visible(context, 'requester')) fields.requester = row.contact_name_id ? { name: row.contact_name ?? null } : null;
  if (visible(context, 'client')) fields.client = row.client_id ? { name: row.client_name ?? null } : null;
  if (visible(context, 'category')) fields.category = row.category_id ? { id: row.category_id, name: row.category_name ?? null } : null;
  if (visible(context, 'due_date')) fields.due_date = row.due_date == null ? null : row.due_date instanceof Date ? row.due_date.toISOString() : String(row.due_date);
  if (visible(context, 'customer_assignee')) {
    const name = [row.assignee_first_name, row.assignee_last_name].filter(Boolean).join(' ').trim();
    fields.customer_assignee = row.assigned_to ? { name: name || null } : null;
  }
  return { resource, revision, fields };
}

/** Rich-text and people context the sponsor's summary deliberately omits. Same
 * live admission and home-policy redaction as the summary; no new authority.
 * Sponsor sessions only: the customer reads its own ticket natively. */
export async function getCoManagedSharedTicketDetails(db: Knex, actor: CoManagedSessionActor,
  resource: CoManagedSharedResource): Promise<CoManagedSharedTicketDetails> {
  if (resource?.kind !== 'ticket') throw new CoManagedSharedWorkError();
  return withCoManagedSharedWork(db, actor, resource, 'read', readDetails);
}
