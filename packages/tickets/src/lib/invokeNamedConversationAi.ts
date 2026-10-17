import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withNamedTicketConversation, publishNamedConversationAiExchange, snapshotCoManagedSessionActor,
  type CoManagedSessionActor } from '@alga-psa/co-managed';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { ConversationAiError, type ConversationAiProvider } from '@alga-psa/shared/lib/tickets/conversationAi';
import { readConversationAiSnapshot, revalidateConversationAiSnapshot } from './conversationAiContext';

export interface NamedConversationAiRequest {
  operationId: string; expectedConversationRevision: number; prompt: string; sources: TicketConversationReference[];
}
const TABLE = 'ticket_conversation_ai_runs';
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
function binding(context: Context) {
  return { actor_user_id: context.actor.userId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    relationship_id: context.ticket.relationshipId ?? null, destination_store_tenant: context.conversation.storeTenant,
    destination_conversation_id: context.conversation.conversationId, kind: 'conversation_reply' };
}
function assertInternal(context: Context) {
  if (context.conversation.transport !== 'internal' || context.conversation.audience === 'requester') throw new TicketConversationError('CONVERSATION_FORBIDDEN');
}
function receipt(context: Context, row: any) {
  return { status: 'completed' as const, storeTenant: context.conversation.storeTenant, threadId: row.published_thread_id as string,
    promptId: row.operation_id as string, replyId: row.published_comment_id as string };
}
export type NamedConversationAiResult = { status: 'running' | 'cancelled' } | ReturnType<typeof receipt>;

/** LEVERAGE: pattern retained-conversation-ai-run — synthesis and internal AI
 * share reservation/attempt semantics; their publication contracts differ.
 * Inference holds no DB transaction. A successful attempt atomically publishes
 * its human prompt and AI reply, without consuming the human's existing draft. */
export async function invokeNamedConversationAi(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputDestination: TicketConversationReference, input: NamedConversationAiRequest, provider: ConversationAiProvider): Promise<NamedConversationAiResult> {
  if (db.isTransaction || !input || Object.keys(input).some(key => !['operationId', 'expectedConversationRevision', 'prompt', 'sources'].includes(key)) ||
      !conversationUuid(input.operationId) || !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 ||
      typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000 || input.prompt.includes('\0') ||
      !Array.isArray(input.sources) || input.sources.length > 64) return invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), destination = snapshotConversationReference(inputDestination);
  const request = { operationId: input.operationId.toLowerCase(), expectedConversationRevision: input.expectedConversationRevision,
    prompt: input.prompt.trim(), sources: input.sources.map(snapshotConversationReference) };
  if (new Set(request.sources.map(ref => `${ref.storeTenant}:${ref.conversationId}`)).size !== request.sources.length) return invalid();
  const hash = createHash('sha256').update(JSON.stringify({ destination, ...request })).digest('hex'), attemptId = randomUUID();
  await provider.assertAvailable(actor);
  const initial = await withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    assertInternal(context);
    const home = tenantDb(context.trx, context.actor.tenant);
    const previous = await home.table(TABLE).where('operation_id', request.operationId).forUpdate()
      .select('*', context.trx.raw('lease_expires_at > clock_timestamp() AS live')).first();
    if (previous) {
      if (Object.entries(binding(context)).some(([key, value]) => previous[key] !== value)) return conflict();
      if (previous.status === 'cancelled' && previous.request.cancelledBeforeStart) return { done: true as const, result: { status: 'cancelled' as const } };
      if (previous.request_hash !== hash) return conflict();
      if (previous.status === 'completed') return { done: true as const, result: receipt(context, previous) };
      if (previous.status === 'cancelled') return { done: true as const, result: { status: 'cancelled' as const } };
      if (previous.status === 'running' && previous.live) return { done: true as const, result: { status: 'running' as const } };
    }
    if (context.conversation.revision !== request.expectedConversationRevision) return conflict();
    const snapshot = await readConversationAiSnapshot(context.trx, actor, ticket, destination, { kind: 'conversation', sources: request.sources });
    const { input: _modelInput, ...manifest } = snapshot;
    const values = { ...binding(context), request_hash: hash, request: JSON.stringify(request), source_snapshot: JSON.stringify(manifest),
      status: 'running', attempt_id: attemptId, lease_expires_at: context.trx.raw("clock_timestamp() + interval '10 minutes'"),
      generated_text: null, prepared_draft_revision: null, failure_code: null, updated_at: context.trx.fn.now() };
    if (previous) await home.table(TABLE).where('operation_id', request.operationId).update(values);
    else await home.table(TABLE).insert({ tenant: context.actor.tenant, operation_id: request.operationId, ...values });
    return { done: false as const, snapshot };
  });
  if (initial.done) return initial.result;
  try {
    const output = await provider.generate({ actor, operationId: request.operationId, kind: 'conversation', input: initial.snapshot.input, prompt: request.prompt });
    if (typeof output !== 'string' || !output.trim() || output.length > 50000 || output.includes('\0')) throw new ConversationAiError('AI_UNAVAILABLE');
    await provider.assertAvailable(actor);
    return await withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
      assertInternal(context);
      const query = () => tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ operation_id: request.operationId, ...binding(context) });
      const row = await query().forUpdate().first();
      if (!row || row.status !== 'running' || row.attempt_id !== attemptId) throw new ConversationAiError('AI_CANCELLED');
      await revalidateConversationAiSnapshot(context.trx, actor, ticket, initial.snapshot);
      const published = await publishNamedConversationAiExchange(context, { promptId: request.operationId, replyId: randomUUID(), prompt: request.prompt, reply: output.trim() });
      await query().update({ status: 'completed', generated_text: output.trim(), published_thread_id: published.threadId,
        published_comment_id: published.replyId, updated_at: context.trx.fn.now() });
      return { status: 'completed' as const, ...published };
    });
  } catch (error) {
    await tenantDb(db, actor.tenant).table(TABLE).where({ operation_id: request.operationId, actor_user_id: actor.userId,
      ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId, kind: 'conversation_reply', attempt_id: attemptId, status: 'running' })
      .update({ status: 'failed', failure_code: error instanceof ConversationAiError || error instanceof TicketConversationError ? error.code : 'AI_UNAVAILABLE', updated_at: db.fn.now() });
    throw error;
  }
}

export async function cancelNamedConversationAi(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) {
  if (!conversationUuid(operationId)) return invalid();
  operationId = operationId.toLowerCase();
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    assertInternal(context);
    const home = tenantDb(context.trx, context.actor.tenant), query = () => home.table(TABLE).where('operation_id', operationId);
    const row = await query().forUpdate().first();
    if (row && Object.entries(binding(context)).some(([key, value]) => row[key] !== value)) return conflict();
    if (row?.status === 'completed') return receipt(context, row);
    if (row) await query().update({ status: 'cancelled', updated_at: context.trx.fn.now() });
    else await home.table(TABLE).insert({ tenant: context.actor.tenant, operation_id: operationId, ...binding(context),
      request_hash: createHash('sha256').update(JSON.stringify(binding(context))).digest('hex'), request: JSON.stringify({ cancelledBeforeStart: true }),
      source_snapshot: '{}', status: 'cancelled', attempt_id: randomUUID(), lease_expires_at: context.trx.fn.now() });
    return { status: 'cancelled' as const };
  });
}
export async function getNamedConversationAiStatus(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) {
  if (!conversationUuid(operationId)) return invalid();
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    assertInternal(context);
    const row = await tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ operation_id: operationId.toLowerCase(), ...binding(context) })
      .select('*', context.trx.raw('lease_expires_at > clock_timestamp() AS live')).first();
    if (!row) return conflict();
    return row.status === 'completed' ? receipt(context, row) : { status: row.status === 'running' && !row.live ? 'failed' as const : row.status as 'running' | 'failed' | 'cancelled' };
  });
}
