import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { resolveCommentAudience, type CommentAudience } from '../commentAudience';

export interface TicketConversationReference { storeTenant: string; conversationId: string }
export interface ConversationTicketReference { tenant: string; ticketId: string; relationshipId?: string }
export interface NamedTicketConversation extends TicketConversationReference {
  ticket: ConversationTicketReference;
  name: string;
  audience: CommentAudience;
  transport: 'email' | 'internal';
  defaultSlot: CommentAudience | null;
  status: 'open' | 'done';
  revision: number;
  messageVersion: string;
  mailbox: { tenant: string; id: string } | null;
  createdAt: string;
}
export class TicketConversationError extends Error {
  constructor(readonly code: 'CONVERSATION_INVALID' | 'CONVERSATION_FORBIDDEN' | 'CONVERSATION_CONFLICT') {
    super(code === 'CONVERSATION_INVALID' ? 'The conversation request is invalid.' : code === 'CONVERSATION_CONFLICT'
      ? 'The conversation changed. Reload it before trying again.' : 'This conversation is not available for the requested operation.');
    this.name = 'TicketConversationError';
  }
}
export function conversationUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
export function snapshotConversationTicket(input: ConversationTicketReference): ConversationTicketReference {
  if (!input || ![input.tenant, input.ticketId].every(conversationUuid) ||
      (input.relationshipId !== undefined && !conversationUuid(input.relationshipId)) ||
      Object.keys(input).some(k => !['tenant', 'ticketId', 'relationshipId'].includes(k))) throw new TicketConversationError('CONVERSATION_INVALID');
  return { tenant: input.tenant.toLowerCase(), ticketId: input.ticketId.toLowerCase(),
    ...(input.relationshipId ? { relationshipId: input.relationshipId.toLowerCase() } : {}) };
}
export function snapshotConversationReference(input: TicketConversationReference): TicketConversationReference {
  if (!input || ![input.storeTenant, input.conversationId].every(conversationUuid) ||
      Object.keys(input).some(k => !['storeTenant', 'conversationId'].includes(k))) throw new TicketConversationError('CONVERSATION_INVALID');
  return { storeTenant: input.storeTenant.toLowerCase(), conversationId: input.conversationId.toLowerCase() };
}

/** Storage engine only. The command boundary must authorize the qualified ticket,
 * actor and audience before calling these operations within its retained transaction.
 * Private stores are selected by that boundary, never by an untrusted list request. */
export interface ConversationStoreScope {
  trx: Knex.Transaction;
  ticket: ConversationTicketReference;
  storeTenant: string;
}
function scoped(scope: ConversationStoreScope) {
  if (!scope.trx.isTransaction || !conversationUuid(scope.storeTenant)) throw new TicketConversationError('CONVERSATION_INVALID');
  const ticket = snapshotConversationTicket(scope.ticket);
  if (scope.storeTenant !== ticket.tenant && !ticket.relationshipId) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  return tenantDb(scope.trx, scope.storeTenant).table('ticket_conversations')
    .where({ ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId })
    .modify(query => {
      if (scope.storeTenant !== ticket.tenant) query.where('relationship_id', ticket.relationshipId!);
    });
}
function view(row: any): NamedTicketConversation {
  return { storeTenant: row.tenant, conversationId: row.conversation_id,
    ticket: { tenant: row.ticket_tenant, ticketId: row.ticket_id, ...(row.relationship_id ? { relationshipId: row.relationship_id } : {}) },
    name: row.name, audience: row.audience, transport: row.transport, defaultSlot: row.default_slot,
    status: row.status, revision: row.revision, messageVersion: String(row.message_version),
    mailbox: row.mailbox_id ? { tenant: row.mailbox_tenant, id: row.mailbox_id } : null,
    createdAt: new Date(row.created_at).toISOString() };
}
export async function listStoredTicketConversations(scope: ConversationStoreScope, audiences: readonly CommentAudience[]): Promise<NamedTicketConversation[]> {
  const rows = await scoped(scope).whereIn('audience', [...audiences]).orderBy('created_at').orderBy('conversation_id');
  return rows.map(view);
}
export async function readStoredTicketConversation(scope: ConversationStoreScope, id: string, lock: 'read' | 'update' = 'read'): Promise<NamedTicketConversation> {
  if (!conversationUuid(id)) throw new TicketConversationError('CONVERSATION_INVALID');
  const query = scoped(scope).where('conversation_id', id);
  if (lock === 'update') query.forUpdate(); else query.forShare();
  const row = await query.first();
  if (!row) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  return view(row);
}
export async function ensureDefaultTicketConversation(scope: ConversationStoreScope, audience: CommentAudience): Promise<NamedTicketConversation> {
  scoped(scope);
  if (!['requester', 'shared_it', 'organization_private'].includes(audience) ||
      (scope.storeTenant !== scope.ticket.tenant && audience !== 'organization_private')) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const store = tenantDb(scope.trx, scope.storeTenant);
  await store.table('ticket_conversations').insert({ tenant: scope.storeTenant, conversation_id: randomUUID(),
    ticket_tenant: scope.ticket.tenant, ticket_id: scope.ticket.ticketId,
    relationship_id: scope.storeTenant === scope.ticket.tenant ? null : scope.ticket.relationshipId,
    name: audience === 'requester' ? 'Requester' : audience === 'shared_it' ? 'Shared IT' : 'Internal',
    audience, transport: audience === 'requester' ? 'email' : 'internal', default_slot: audience,
  }).onConflict().ignore();
  const row = await scoped(scope).where('default_slot', audience).first();
  if (!row) throw new TicketConversationError('CONVERSATION_CONFLICT');
  return view(row);
}
export interface CreateTicketConversation {
  operationId: string;
  name: string;
  audience: CommentAudience;
  transport: 'email' | 'internal';
}
export function snapshotCreateConversation(input: CreateTicketConversation): CreateTicketConversation {
  if (!input || !conversationUuid(input.operationId) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 160 ||
      /[\u0000-\u001f\u007f]/.test(input.name) || !['requester', 'shared_it', 'organization_private'].includes(input.audience) ||
      !['email', 'internal'].includes(input.transport) || Object.keys(input).some(k => !['operationId', 'name', 'audience', 'transport'].includes(k))) {
    throw new TicketConversationError('CONVERSATION_INVALID');
  }
  return { operationId: input.operationId.toLowerCase(), name: input.name.trim(), audience: input.audience, transport: input.transport };
}
export async function createStoredTicketConversation(scope: ConversationStoreScope, actor: { tenant: string; userId: string }, input: CreateTicketConversation): Promise<NamedTicketConversation> {
  scoped(scope);
  const request = snapshotCreateConversation(input);
  if (![actor.tenant, actor.userId].every(conversationUuid) ||
      (scope.storeTenant !== scope.ticket.tenant && request.audience !== 'organization_private')) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const hash = createHash('sha256').update(JSON.stringify({ actor, ticket: scope.ticket, request })).digest('hex');
  await tenantDb(scope.trx, scope.storeTenant).table('ticket_conversations').insert({
    tenant: scope.storeTenant, conversation_id: request.operationId, ticket_tenant: scope.ticket.tenant, ticket_id: scope.ticket.ticketId,
    relationship_id: scope.storeTenant === scope.ticket.tenant ? null : scope.ticket.relationshipId,
    name: request.name, audience: request.audience, transport: request.transport,
    created_by_tenant: actor.tenant, created_by_user_id: actor.userId, creation_hash: hash,
  }).onConflict(['tenant', 'conversation_id']).ignore();
  const row = await scoped(scope).where('conversation_id', request.operationId).forShare().first();
  if (!row || row.creation_hash !== hash) throw new TicketConversationError('CONVERSATION_CONFLICT');
  return view(row);
}
export async function setStoredConversationStatus(scope: ConversationStoreScope, id: string, expectedRevision: number, status: 'open' | 'done') {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !['open', 'done'].includes(status)) throw new TicketConversationError('CONVERSATION_INVALID');
  const row = await readStoredTicketConversation(scope, id, 'update');
  if (row.revision !== expectedRevision) throw new TicketConversationError('CONVERSATION_CONFLICT');
  const [updated] = await scoped(scope).where({ conversation_id: id, revision: expectedRevision })
    .update({ status, revision: expectedRevision + 1, updated_at: scope.trx.fn.now() }).returning('*');
  return view(updated);
}

/** Native roots inherit the named container, but replies retain their original
 * root/parent identities. Default routing is also used by legacy write adapters. */
export async function attachNativeRootToConversation(scope: ConversationStoreScope, threadId: string, conversationId?: string) {
  if (scope.storeTenant !== scope.ticket.tenant || !conversationUuid(threadId)) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const owner = tenantDb(scope.trx, scope.storeTenant);
  const thread = await owner.table('comment_threads').where({ thread_id: threadId, ticket_id: scope.ticket.ticketId }).forUpdate().first();
  if (!thread) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  const audience = resolveCommentAudience(thread);
  const inconsistent = await owner.table('comments').where('thread_id', threadId)
    .where(query => query.whereRaw('ticket_id IS DISTINCT FROM ?::uuid', [scope.ticket.ticketId])
      .orWhereRaw('is_internal IS DISTINCT FROM ?::boolean', [audience !== 'requester'])).first('comment_id');
  if (inconsistent) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  if (conversationId && thread.conversation_id && thread.conversation_id !== conversationId) throw new TicketConversationError('CONVERSATION_CONFLICT');
  const id = conversationId || thread.conversation_id;
  const destination = id ? await readStoredTicketConversation(scope, id) : await ensureDefaultTicketConversation(scope, audience);
  if (destination.audience !== audience) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  if (!thread.conversation_id) await owner.table('comment_threads').where('thread_id', threadId).update({ conversation_id: destination.conversationId });
  return destination;
}

/** Private roots never cross their retained relationship or home store. */
export async function attachPrivateRootToConversation(scope: ConversationStoreScope, threadId: string, conversationId?: string) {
  if (scope.storeTenant === scope.ticket.tenant || !conversationUuid(threadId) || !scope.ticket.relationshipId) {
    throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  }
  const home = tenantDb(scope.trx, scope.storeTenant);
  const thread = await home.table('co_management_private_threads').where({ thread_id: threadId,
    customer_tenant: scope.ticket.tenant, relationship_id: scope.ticket.relationshipId,
    resource_type: 'ticket', resource_id: scope.ticket.ticketId }).forUpdate().first();
  if (!thread || thread.disclosure_operation_id) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  if (conversationId && thread.conversation_id && thread.conversation_id !== conversationId) throw new TicketConversationError('CONVERSATION_CONFLICT');
  const id = conversationId || thread.conversation_id;
  const destination = id ? await readStoredTicketConversation(scope, id) : await ensureDefaultTicketConversation(scope, 'organization_private');
  if (destination.audience !== 'organization_private') throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  if (!thread.conversation_id) await home.table('co_management_private_threads').where('thread_id', threadId).update({ conversation_id: destination.conversationId });
  return destination;
}
