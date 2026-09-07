import { createHash } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { assertCoManagedOperationalWrite, CoManagedLifecycleError } from '@alga-psa/licensing';
import { withCoManagedSharedWork, type CoManagedSharedResource, type CoManagedSharedWorkContext } from './sharedWork';
import { CoManagedSharedWorkError, isCoManagedUuid, snapshotCoManagedSessionActor, assertCoManagedSessionUnexpired, type CoManagedSessionActor } from './sharedWorkIdentity';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';
import { ensureCoManagedActorReference } from './actorReferences';

export interface CoManagedTicketEditValues {
  title: string;
  url: string | null;
  status_id: string;
  priority_id: string | null;
  due_date: string | null;
  response_state: 'awaiting_client' | 'awaiting_internal' | null;
}
export type CoManagedTicketEditField = keyof CoManagedTicketEditValues;
export type CoManagedTicketEditPatch = Partial<CoManagedTicketEditValues>;
export interface CoManagedTicketEditRequest { operationId: string; expected: CoManagedTicketEditPatch; patch: CoManagedTicketEditPatch }
export interface CoManagedTicketEditReceipt { operationId: string; appliedAt: string }
export interface CoManagedTicketEditorState {
  resource: CoManagedSharedResource;
  values: CoManagedTicketEditPatch;
  editableFields: CoManagedTicketEditField[];
  selectedOptions: Partial<Record<'status_id' | 'priority_id', { id: string; name: string }>>;
}
export interface CoManagedTicketEditContext extends CoManagedSharedWorkContext {
  actorReferenceId: string;
  assertWriteAuthority: (trx: Knex.Transaction) => Promise<void>;
}
export class CoManagedTicketEditError extends Error {
  constructor(public readonly code: 'INVALID_TICKET_EDIT' | 'TICKET_EDIT_CONFLICT' | 'TICKET_EDIT_OPERATION_CONFLICT') {
    super({ INVALID_TICKET_EDIT: 'The shared ticket edit is not valid.',
      TICKET_EDIT_CONFLICT: 'The ticket changed. Reload it before saving.',
      TICKET_EDIT_OPERATION_CONFLICT: 'This operation was already used for a different edit.' }[code]);
    this.name = 'CoManagedTicketEditError';
  }
}
const fields: CoManagedTicketEditField[] = ['title', 'url', 'status_id', 'priority_id', 'due_date', 'response_state'];
const fieldSources: Record<CoManagedTicketEditField, string[]> = {
  title: ['title', 'tickets.title'], url: ['url', 'tickets.url'], due_date: ['due_date', 'tickets.due_date'],
  response_state: ['response_state', 'tickets.response_state'],
  status_id: ['status', 'status_id', 'status_name', 'tickets.status_id', 'statuses'],
  priority_id: ['priority', 'priority_id', 'priority_name', 'tickets.priority_id', 'priorities'],
};
const normalizeValue = (value: unknown): string | null => value == null ? null : value instanceof Date ? value.toISOString() : String(value);
const hidden = (context: CoManagedSharedWorkContext, field: CoManagedTicketEditField) => isCoManagedReadFieldHidden(context.redactedFields, fieldSources[field]);
function ticketResource(input: CoManagedSharedResource): CoManagedSharedResource {
  if (!input || input.kind !== 'ticket' || ![input.tenant, input.relationshipId, input.id].every(isCoManagedUuid)) throw new CoManagedSharedWorkError();
  return { kind: 'ticket', tenant: input.tenant.toLowerCase(), relationshipId: input.relationshipId.toLowerCase(), id: input.id.toLowerCase() };
}
function snapshotRequest(input: CoManagedTicketEditRequest): CoManagedTicketEditRequest {
  const invalid = () => { throw new CoManagedTicketEditError('INVALID_TICKET_EDIT'); };
  if (!input || !isCoManagedUuid(input.operationId) || Object.keys(input).some(key => !['operationId', 'expected', 'patch'].includes(key))) invalid();
  const expected: Record<string, string | null> = {}, patch: Record<string, string | null> = {};
  for (const key of ['expected', 'patch'] as const) {
    const value = input[key];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(field => !fields.includes(field as CoManagedTicketEditField))) invalid();
  }
  const keys = fields.filter(field => Object.prototype.hasOwnProperty.call(input.patch, field));
  if (!keys.length || keys.length !== Object.keys(input.expected).length || keys.some(field => !Object.prototype.hasOwnProperty.call(input.expected, field))) invalid();
  for (const field of keys) {
    const before = input.expected[field], value = input.patch[field];
    if ((before !== null && typeof before !== 'string') || (value !== null && typeof value !== 'string')) invalid();
    if ((typeof value === 'string' && value.includes('\0')) || (typeof before === 'string' && before.includes('\0'))) invalid();
    if (field === 'title' && (typeof value !== 'string' || !value.trim() || value.length > 255)) invalid();
    if (field === 'url' && typeof value === 'string' && value.length > 2048) invalid();
    if (field === 'status_id' && !isCoManagedUuid(value)) invalid();
    if (field === 'priority_id' && value !== null && !isCoManagedUuid(value)) invalid();
    if (field === 'due_date' && value !== null && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value)))) invalid();
    if (field === 'response_state' && value !== null && value !== 'awaiting_client' && value !== 'awaiting_internal') invalid();
    expected[field] = before!; patch[field] = value!;
  }
  return { operationId: input.operationId.toLowerCase(), expected, patch } as CoManagedTicketEditRequest;
}

async function ticketRow(context: CoManagedSharedWorkContext) {
  const row = await tenantDb(context.trx, context.resource.tenant).table('tickets').where('ticket_id', context.resource.id)
    .first(...fields, 'board_id', 'master_ticket_id');
  if (!row) throw new CoManagedSharedWorkError();
  return row;
}
async function editableFields(context: CoManagedSharedWorkContext, readContext: CoManagedSharedWorkContext, row: any) {
  const settings = await tenantDb(context.trx, context.resource.tenant).table('ticket_bundle_settings')
    .where('master_ticket_id', context.resource.id).forShare().first('mode');
  return fields.filter(field => !hidden(context, field) && !hidden(readContext, field) &&
    (!['status_id', 'priority_id'].includes(field) || (!row.master_ticket_id && settings?.mode !== 'sync_updates')));
}
async function readEditor(context: CoManagedSharedWorkContext, editable: CoManagedTicketEditField[] = []): Promise<CoManagedTicketEditorState> {
  const owner = tenantDb(context.trx, context.resource.tenant), row = await ticketRow(context);
  const values: Record<string, string | null> = {};
  for (const field of fields) if (!hidden(context, field)) values[field] = normalizeValue(row[field]);
  const selectedOptions: CoManagedTicketEditorState['selectedOptions'] = {};
  if ('status_id' in values && row.status_id) {
    const status = await owner.table('statuses').where({ status_id: row.status_id, board_id: row.board_id, item_type: 'ticket' }).first('name');
    if (status) selectedOptions.status_id = { id: row.status_id, name: status.name };
  }
  if ('priority_id' in values && row.priority_id) {
    const priority = await owner.table('priorities').where({ priority_id: row.priority_id, item_type: 'ticket' }).first('priority_name');
    if (priority) selectedOptions.priority_id = { id: row.priority_id, name: priority.priority_name };
  }
  await assertCoManagedSessionUnexpired(context.trx, { ...context.actor, kind: 'session', sessionId: context.sessionId });
  if (editable.length) await assertCoManagedOperationalWrite(context.trx, context.resource.tenant);
  return { resource: context.resource, values: values as CoManagedTicketEditPatch, editableFields: editable, selectedOptions };
}

/** Acquire the write lock before the read lock for editable screens. Two screen
 * reads must never both hold SHARE and then attempt to upgrade to UPDATE. */
export async function getCoManagedTicketEditor(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource): Promise<CoManagedTicketEditorState> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = ticketResource(inputResource);
  try {
    return await withCoManagedSharedWork(db, actor, resource, 'update', context =>
      withCoManagedSharedWork(context.trx, actor, resource, 'read', async readContext =>
        readEditor(readContext, await editableFields(context, readContext, await ticketRow(context)))));
  } catch (error) {
    if (!(error instanceof CoManagedSharedWorkError) && !(error instanceof CoManagedLifecycleError)) throw error;
    return withCoManagedSharedWork(db, actor, resource, 'read', context => readEditor(context));
  }
}

/** Picklists are customer-owned context for this editable ticket, not directory
 * access. Both action permissions and field redactions apply on every page. */
export async function searchCoManagedTicketEditOptions(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: { field: 'status_id' | 'priority_id'; search?: string; afterId?: string }) {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = ticketResource(inputResource);
  if (!input || !['status_id', 'priority_id'].includes(input.field) || (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      (input.afterId !== undefined && !isCoManagedUuid(input.afterId))) throw new CoManagedTicketEditError('INVALID_TICKET_EDIT');
  const { field, search = '', afterId } = input;
  return withCoManagedSharedWork(db, actor, resource, 'update', context =>
    withCoManagedSharedWork(context.trx, actor, resource, 'read', async readContext => {
      const row = await ticketRow(context);
      if (!(await editableFields(context, readContext, row)).includes(field)) throw new CoManagedSharedWorkError();
      const owner = tenantDb(context.trx, resource.tenant), name = field === 'status_id' ? 'name' : 'priority_name';
      const query = owner.table(field === 'status_id' ? 'statuses' : 'priorities').where('item_type', 'ticket').orderBy(field).limit(26);
      if (field === 'status_id') query.where('board_id', row.board_id);
      if (afterId) query.where(field, '>', afterId);
      if (search) query.whereILike(name, `%${search.replace(/[\\%_]/g, '\\$&')}%`);
      const rows = await query.select(`${field} as id`, `${name} as name`);
      const options = rows.slice(0, 25).map(option => ({ id: option.id as string, name: option.name as string }));
      await assertCoManagedSessionUnexpired(context.trx, actor);
      await assertCoManagedOperationalWrite(context.trx, resource.tenant);
      return { options, nextAfterId: rows.length > 25 ? options.at(-1)!.id : null };
    }));
}

/** The application supplies the existing canonical mutation engine. The domain
 * retains qualified authority, baseline checking and receipt atomicity; it does
 * not create a shadow ticket or import the tickets package back into its model. */
export async function editCoManagedTicket(db: Knex, inputActor: CoManagedSessionActor, inputResource: CoManagedSharedResource,
  input: CoManagedTicketEditRequest, apply: (context: CoManagedTicketEditContext, patch: CoManagedTicketEditPatch) => Promise<void>): Promise<CoManagedTicketEditReceipt> {
  const actor = snapshotCoManagedSessionActor(inputActor), resource = ticketResource(inputResource), request = snapshotRequest(input);
  // LEVERAGE: pattern co-managed-command-receipt — shared edits and private notes
  // share retry semantics while retaining different receipt ownership.
  const hash = createHash('sha256').update(JSON.stringify({ resource, actor: { tenant: actor.tenant, userId: actor.userId }, command: 'ticket_edit', request })).digest('hex');
  try {
    return await withCoManagedSharedWork(db, actor, resource, 'update', context =>
      withCoManagedSharedWork(context.trx, actor, resource, 'read', async readContext => {
        const owner = tenantDb(context.trx, resource.tenant), row = await ticketRow(context);
        const allowed = await editableFields(context, readContext, row);
        if (Object.keys(request.patch).some(field => !allowed.includes(field as CoManagedTicketEditField))) throw new CoManagedSharedWorkError();
        const previous = await owner.table('co_management_command_receipts').where('operation_id', request.operationId).forShare().first();
        if (previous) {
          if (previous.request_hash !== hash) throw new CoManagedTicketEditError('TICKET_EDIT_OPERATION_CONFLICT');
          return { operationId: request.operationId, appliedAt: normalizeValue(previous.applied_at)! };
        }
        if (Object.entries(request.expected).some(([field, value]) => normalizeValue(row[field]) !== value)) throw new CoManagedTicketEditError('TICKET_EDIT_CONFLICT');
        if (request.patch.status_id && !await owner.table('statuses').where({ status_id: request.patch.status_id,
          board_id: row.board_id, item_type: 'ticket' }).forShare().first('status_id')) throw new CoManagedTicketEditError('INVALID_TICKET_EDIT');
        if (request.patch.priority_id && !await owner.table('priorities').where({ priority_id: request.patch.priority_id, item_type: 'ticket' }).forShare().first('priority_id')) {
          throw new CoManagedTicketEditError('INVALID_TICKET_EDIT');
        }
        const actorReferenceId = await ensureCoManagedActorReference(context);
        const assertWriteAuthority = async (trx: Knex.Transaction) => {
          if (trx !== context.trx) throw new CoManagedSharedWorkError();
          await assertCoManagedSessionUnexpired(trx, actor);
          await assertCoManagedOperationalWrite(trx, resource.tenant);
        };
        await assertWriteAuthority(context.trx);
        await apply({ ...context, actorReferenceId, assertWriteAuthority }, request.patch);
        const [receipt] = await owner.table('co_management_command_receipts').insert({ tenant: resource.tenant, operation_id: request.operationId,
          relationship_id: resource.relationshipId, resource_type: 'ticket', resource_id: resource.id, actor_tenant: actor.tenant,
          actor_user_id: actor.userId, command_type: 'ticket_edit', request_hash: hash, applied_at: context.trx.raw('clock_timestamp()'),
        }).returning('applied_at');
        return { operationId: request.operationId, appliedAt: normalizeValue(receipt.applied_at)! };
      }));
  } catch (error) {
    // A UUID reused concurrently for another resource aborts the entire owning
    // transaction, including its canonical edit and after-commit effects.
    if ((error as { code?: string; constraint?: string })?.code === '23505' &&
        (error as { constraint?: string }).constraint === 'co_management_command_receipts_pkey') throw new CoManagedTicketEditError('TICKET_EDIT_OPERATION_CONFLICT');
    throw error;
  }
}
