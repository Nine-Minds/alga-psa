import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { AmpEntityType } from '@alga-psa/migration-spec';
import type { ApplierContext } from './context';
import type { AppliedTarget } from './entityAppliers';

/** Workspace import writes business state without publishing native creation events. Ordinary
 * configured imports retain their existing model-based appliers and notifications. */
export async function applyQuietCore(trx: Knex.Transaction, context: ApplierContext, entity: AmpEntityType, row: Record<string, unknown>, customFieldValues: Record<string, unknown> = {}): Promise<AppliedTarget> {
  const own = tenantDb(trx, context.tenant), id = randomUUID();
  const ref = async (field: string, target: AmpEntityType) => {
    if (row[field] == null) return null;
    const resolved = await context.resolveReference(trx, target, String(row[field]));
    if (!resolved) throw new Error(`Unapplied dependency ${entity}.${field}`);
    return resolved;
  };
  const base = { tenant: context.tenant };
  let table: string, key: string, values: Record<string, unknown>;
  if (entity === 'organizations') {
    table = 'clients'; key = 'client_id'; values = { ...base, client_name: row.name, url: row.website, properties: { phone: row.phone ?? null } };
  } else if (entity === 'locations') {
    table = 'client_locations'; key = 'location_id'; values = { ...base, client_id: await ref('organization_package_record_id', 'organizations'), location_name: row.name,
      address_line1: row.address_line1, address_line2: row.address_line2, city: row.city, state_province: row.region, postal_code: row.postal_code,
      country_code: row.country_code, country_name: row.country_code, phone: row.phone };
  } else if (entity === 'contacts') {
    table = 'contacts'; key = 'contact_name_id'; values = { ...base, client_id: await ref('organization_package_record_id', 'organizations'),
      full_name: [row.first_name, row.last_name].filter(Boolean).join(' '), email: row.email, role: row.title, is_inactive: true };
  } else if (entity === 'tickets') {
    const config = context.configuration.tickets;
    if (!config) throw new Error('Ticket reference configuration required');
    table = 'tickets'; key = 'ticket_id'; values = { ...base, ticket_number: `AMP-${id}`, title: row.title,
      client_id: await ref('organization_package_record_id', 'organizations') ?? config.defaultRequesterClientId,
      contact_name_id: await ref('requester_package_record_id', 'contacts'), location_id: await ref('location_package_record_id', 'locations'),
      board_id: await ref('board_package_record_id', 'work_boards') ?? config.boardId, status_id: await ref('status_package_record_id', 'work_statuses') ?? config.statusMapping[String(row.status_name)] ?? null,
      priority_id: await ref('priority_package_record_id', 'work_priorities') ?? config.priorityMapping[String(row.priority_name)] ?? null, category_id: await ref('category_package_record_id', 'work_categories'), assigned_to: await ref('assignee_package_record_id', 'people'), entered_by: context.actorUserId,
      closed_at: row.closed_at, is_closed: Boolean(row.closed_at), source: 'migration', attributes: { description: row.description ?? null, source_category: row.category_name ?? null } };
  } else if (entity === 'ticket_comments') {
    const ticketId = await ref('ticket_package_record_id', 'tickets');
    const parentId = await ref('parent_package_record_id', 'ticket_comments');
    const parent = parentId ? await own.table('comments').where({ comment_id: parentId }).first('thread_id') : null;
    const threadId = await ref('thread_package_record_id', 'conversation_threads') ?? parent?.thread_id ?? randomUUID();
    if (!row.thread_package_record_id && !parent) await own.table('comment_threads').insert({ ...base, thread_id: threadId, root_comment_id: id, ticket_id: ticketId, is_internal: row.is_internal === 1, collaboration_audience: row.is_internal === 1 ? 'organization_private' : 'requester', created_by: context.actorUserId });
    table = 'comments'; key = 'comment_id'; values = { ...base, ticket_id: ticketId, thread_id: threadId, user_id: await ref('author_person_package_record_id', 'people') ?? context.actorUserId, parent_comment_id: parentId,
      contact_id: await ref('author_package_record_id', 'contacts'), note: row.body, is_internal: row.is_internal === 1, is_resolution: false,
      publish_state: row.publication_state && row.publication_state !== 'published' ? 'canceled' : 'published', published_at: row.publication_state && row.publication_state !== 'published' ? null : row.published_at ?? row.created_at ?? trx.fn.now(), created_at: row.created_at ?? trx.fn.now() };
  } else if (entity === 'assets') {
    table = 'assets'; key = 'asset_id'; values = { ...base, name: row.name, asset_tag: row.tag ?? `AMP-${id}`, status: row.status ?? 'active', asset_type: row.asset_type_name ?? 'workstation',
      client_id: await ref('organization_package_record_id', 'organizations') ?? context.configuration.defaultClientId,
      location_id: await ref('location_package_record_id', 'locations'), contact_name_id: await ref('assignee_package_record_id', 'contacts') ?? (row.assignee_external_identifier ? await context.resolveReference(trx, 'contacts', String(row.assignee_external_identifier)) : null), notes_document_id: await ref('notes_document_package_record_id', 'documents'), warranty_end_date: row.warranty_ends_on, attributes: customFieldValues, serial_number: row.serial_number, manufacturer: row.manufacturer, model: row.model, purchase_date: row.purchase_date };
  } else throw new Error(`No quiet core projection for ${entity}`);
  if (entity === 'ticket_comments' && row.author_historical_package_record_id) {
    const actorId = await ref('author_historical_package_record_id', 'historical_people');
    const actor = await own.table('collaboration_actor_references').where({ actor_reference_id: actorId }).first();
    if (!actor) throw new Error('Historical author has not been applied');
    Object.assign(values, { user_id: null, contact_id: null, author_type: 'internal', actor_reference_id: actorId,
      actor_display_name: row.author_name ?? actor.display_name, actor_organization_name: row.author_organization ?? actor.organization_name });
  }
  values[key] = id;
  await own.table(table).insert(values);
  if (entity === 'contacts' && row.phone) {
    const explicit = await own.table('migration_staged_records').where({ migration_job_id: context.migrationJobId, entity_type: 'contact_phones' })
      .whereRaw("payload ->> 'contact_package_record_id' = ?", [String(row.package_record_id)]).first('package_record_id');
    if (!explicit) await own.table('contact_phone_numbers').insert({ tenant: context.tenant, contact_phone_number_id: randomUUID(),
      contact_name_id: id, phone_number: row.phone, canonical_type: 'work', is_default: true });
  }
  return { targetEntityType: table, targetEntityId: id };
}
