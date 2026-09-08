import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import { withNamedTicketConversation, getNamedConversationEditorDraft, saveNamedConversationEditorDraft,
  snapshotCoManagedSessionActor, type CoManagedSessionActor } from '@alga-psa/co-managed';
import { conversationUuid, snapshotConversationReference, snapshotConversationTicket, TicketConversationError,
  type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { snapshotConversationEmailDraft, reviewConversationEmailDraft, type ConversationEmailDraft } from '@alga-psa/shared/lib/tickets/conversationEmailEnvelope';
import { ConversationAiError, type ConversationAiProvider, type ConversationAiSnapshot } from '@alga-psa/shared/lib/tickets/conversationAi';
import { readConversationAiSnapshot, revalidateConversationAiSnapshot } from './conversationAiContext';

export interface NamedConversationSynthesisRequest {
  operationId: string; source: TicketConversationReference; expectedDraftRevision: number; expectedConversationRevision: number;
  replaceExisting: boolean; prompt: string; email?: ConversationEmailDraft;
}
const TABLE = 'ticket_conversation_ai_runs';
const conflict = (): never => { throw new TicketConversationError('CONVERSATION_CONFLICT'); };
const invalid = (): never => { throw new TicketConversationError('CONVERSATION_INVALID'); };
type Context = Parameters<Parameters<typeof withNamedTicketConversation>[5]>[0];
function binding(context: Context) {
  return { actor_user_id: context.actor.userId, ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId,
    relationship_id: context.ticket.relationshipId ?? null, destination_store_tenant: context.conversation.storeTenant,
    destination_conversation_id: context.conversation.conversationId, kind: 'synthesis' };
}
function draftQuery(context: Context) {
  // LEVERAGE: pattern qualified-editor-draft-scope — transformations need the same private-draft CAS as publication.
  return tenantDb(context.trx, context.actor.tenant).table('ticket_conversation_editor_drafts').where({ actor_user_id: context.actor.userId,
    ticket_tenant: context.ticket.tenant, ticket_id: context.ticket.ticketId, conversation_store_tenant: context.conversation.storeTenant,
    conversation_id: context.conversation.conversationId });
}
export type NamedConversationSynthesisResult = { status: 'running' | 'cancelled' }
  | { status: 'completed'; draft: Awaited<ReturnType<typeof getNamedConversationEditorDraft>>; sourceChanged: boolean };

/** Reserve private intent, release all DB transactions for inference, then apply
 * only to the unchanged author/destination draft. An attempt token protects
 * against late results after cancellation or an expired-lease retry. */
export async function prepareNamedConversationSynthesis(db: Knex, inputActor: CoManagedSessionActor, inputTicket: ConversationTicketReference,
  inputDestination: TicketConversationReference, input: NamedConversationSynthesisRequest, provider: ConversationAiProvider): Promise<NamedConversationSynthesisResult> {
  if (db.isTransaction || !input || Object.keys(input).some(key => !['operationId', 'source', 'expectedDraftRevision', 'expectedConversationRevision', 'replaceExisting', 'prompt', 'email'].includes(key)) ||
    !conversationUuid(input.operationId) || !Number.isSafeInteger(input.expectedDraftRevision) || input.expectedDraftRevision < 0 ||
    !Number.isSafeInteger(input.expectedConversationRevision) || input.expectedConversationRevision < 1 || typeof input.replaceExisting !== 'boolean' ||
    typeof input.prompt !== 'string' || input.prompt.length > 4000) return invalid();
  const actor = snapshotCoManagedSessionActor(inputActor), ticket = snapshotConversationTicket(inputTicket), destination = snapshotConversationReference(inputDestination);
  const email = snapshotConversationEmailDraft(input.email); if (email) reviewConversationEmailDraft(email, []);
  const request = { operationId: input.operationId.toLowerCase(), source: snapshotConversationReference(input.source),
    expectedDraftRevision: input.expectedDraftRevision, expectedConversationRevision: input.expectedConversationRevision,
    replaceExisting: input.replaceExisting, prompt: input.prompt.trim(), ...(email ? { email } : {}) };
  const requestHash = createHash('sha256').update(JSON.stringify({ destination, ...request })).digest('hex');
  const attemptId = randomUUID();
  await provider.assertAvailable(actor);
  const initial = await withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    const home = tenantDb(context.trx, actor.tenant);
    const previous = await home.table(TABLE).where('operation_id', request.operationId).forUpdate()
      .select('*', context.trx.raw('lease_expires_at > clock_timestamp() as live')).first();
    if (previous) {
      if (Object.entries(binding(context)).some(([key, value]) => previous[key] !== value)) return conflict();
      if (previous.status === 'cancelled' && previous.request.cancelledBeforeStart === true) return { completed: true as const, result: { status: 'cancelled' as const } };
      if (previous.request_hash !== requestHash) return conflict();
      if (previous.status === 'completed') return { completed: true as const, result: { status: 'completed' as const,
        draft: await getNamedConversationEditorDraft(context.trx, actor, ticket, destination), sourceChanged: await synthesisSourceChanged(context, previous.source_snapshot) } };
      if (previous.status === 'cancelled') return { completed: true as const, result: { status: 'cancelled' as const } };
      if (previous.status === 'running' && previous.live) return { completed: true as const, result: { status: 'running' as const } };
    }
    if (context.conversation.revision !== request.expectedConversationRevision || (email && context.conversation.transport !== 'email')) return conflict();
    await getNamedConversationEditorDraft(context.trx, actor, ticket, destination);
    const current = await draftQuery(context).forUpdate().first();
    if ((current?.revision ?? 0) !== request.expectedDraftRevision || current?.content != null && !request.replaceExisting) return conflict();
    const snapshot = await readConversationAiSnapshot(context.trx, actor, ticket, destination, { kind: 'synthesis', source: request.source });
    const { input: modelInput, ...retainedSnapshot } = snapshot;
    const values = { ...binding(context), kind: 'synthesis', request_hash: requestHash, request: JSON.stringify(request), source_snapshot: JSON.stringify(retainedSnapshot),
      status: 'running', attempt_id: attemptId, lease_expires_at: context.trx.raw("clock_timestamp() + interval '10 minutes'"),
      generated_text: null, prepared_draft_revision: null, failure_code: null, updated_at: context.trx.fn.now() };
    if (previous) await home.table(TABLE).where('operation_id', request.operationId).update(values);
    else await home.table(TABLE).insert({ tenant: actor.tenant, operation_id: request.operationId, ...values });
    return { completed: false as const, snapshot };
  });
  if (initial.completed) return initial.result;
  try {
    const text = await provider.generate({ actor, operationId: request.operationId, kind: 'synthesis', input: initial.snapshot.input, prompt: request.prompt });
    if (typeof text !== 'string' || !text.trim() || text.length > 50000) throw new ConversationAiError('AI_UNAVAILABLE');
    await provider.assertAvailable(actor);
    return await withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
      const query = () => tenantDb(context.trx, actor.tenant).table(TABLE).where({ operation_id: request.operationId, ...binding(context) });
      const run = await query().forUpdate().first();
      if (!run || run.attempt_id !== attemptId || run.status !== 'running') throw new ConversationAiError('AI_CANCELLED');
      const { newSourceMessages } = await revalidateConversationAiSnapshot(context.trx, actor, ticket, initial.snapshot);
      const draft = await saveNamedConversationEditorDraft(context.trx, actor, ticket, destination, { operationId: request.operationId,
        expectedRevision: request.expectedDraftRevision, expectedConversationRevision: request.expectedConversationRevision,
        content: { text: text.trim() }, attachments: [], email, parent: null, publicationOptions: null });
      if (!draft) return conflict();
      await draftQuery(context).update({ provenance: JSON.stringify({ kind: 'conversation_synthesis', operationId: request.operationId, requestHash }) });
      await query().update({ status: 'completed', generated_text: text.trim(), prepared_draft_revision: draft.revision, updated_at: context.trx.fn.now() });
      return { status: 'completed' as const, draft, sourceChanged: newSourceMessages };
    });
  } catch (error) {
    // Trusted cleanup is restricted to the exact admitted author/run/attempt.
    // It stores no error message or model output and cannot overwrite a newer
    // attempt, cancellation, completed draft, or business resource after revocation.
    await tenantDb(db, actor.tenant).table(TABLE).where({ operation_id: request.operationId, actor_user_id: actor.userId,
      ticket_tenant: ticket.tenant, ticket_id: ticket.ticketId, attempt_id: attemptId, status: 'running' })
      .update({ status: 'failed', failure_code: error instanceof ConversationAiError || error instanceof TicketConversationError ? error.code : 'AI_UNAVAILABLE', updated_at: db.fn.now() });
    throw error;
  }
}

export async function cancelNamedConversationSynthesis(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) {
  if (!conversationUuid(operationId)) return invalid();
  operationId = operationId.toLowerCase();
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    const home = tenantDb(context.trx, context.actor.tenant);
    const query = home.table(TABLE).where({ operation_id: operationId });
    const run = await query.clone().forUpdate().first();
    if (run && Object.entries(binding(context)).some(([key, value]) => run[key] !== value)) return conflict();
    if (!run) {
      // Cancellation may arrive while provider availability/source admission is
      // still pending. Retain that intent so later reservation cannot revive it.
      await home.table(TABLE).insert({ tenant: context.actor.tenant, operation_id: operationId, ...binding(context), kind: 'synthesis',
        request_hash: createHash('sha256').update(JSON.stringify(binding(context))).digest('hex'),
        request: JSON.stringify({ cancelledBeforeStart: true }), source_snapshot: '{}', status: 'cancelled',
        attempt_id: randomUUID(), lease_expires_at: context.trx.fn.now() });
      return { status: 'cancelled' as const };
    }
    if (run.status === 'running' || run.status === 'failed') await query.update({ status: 'cancelled', updated_at: context.trx.fn.now() });
    return { status: run.status === 'completed' ? 'completed' as const : 'cancelled' as const };
  });
}

export async function getNamedConversationSynthesisStatus(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) {
  if (!conversationUuid(operationId)) return invalid();
  operationId = operationId.toLowerCase();
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    const run = await tenantDb(context.trx, context.actor.tenant).table(TABLE).where({ operation_id: operationId, ...binding(context) })
      .select('*', context.trx.raw('lease_expires_at > clock_timestamp() as live')).first();
    if (!run) return conflict();
    // A lost worker must become retryable in the UI; keep the retained attempt
    // until explicit retry/cancel wins so late completion still uses its CAS.
    if (run.status === 'running' && !run.live) return { status: 'failed' as const, sourceChanged: false };
    if (run.status !== 'completed') return { status: run.status as 'running' | 'failed' | 'cancelled', sourceChanged: false };
    return { status: 'completed' as const, sourceChanged: await synthesisSourceChanged(context, run.source_snapshot) };
  });
}

async function synthesisSourceChanged(context: Context, snapshot: Omit<ConversationAiSnapshot, 'input'>) {
  try {
    const { newSourceMessages } = await revalidateConversationAiSnapshot(context.trx, context.actor, context.ticket,
      { ...snapshot, input: { audience: context.conversation.audience, conversations: [] } });
    return newSourceMessages;
  } catch (error) {
    if (error instanceof ConversationAiError && ['AI_SOURCE_CHANGED', 'AI_SOURCE_INVALID', 'AI_CONTEXT_TOO_LARGE'].includes(error.code)) return true;
    throw error;
  }
}

/** Only the current author's actual synthesis draft exposes this private source
 * selector. No provenance is added to public history or the general draft DTO. */
export async function getNamedConversationDraftSynthesis(db: Knex, actor: CoManagedSessionActor, ticket: ConversationTicketReference,
  destination: TicketConversationReference) {
  return withNamedTicketConversation(db, actor, ticket, destination, 'update', async context => {
    const draft = await getNamedConversationEditorDraft(context.trx, context.actor, context.ticket,
      { storeTenant: context.conversation.storeTenant, conversationId: context.conversation.conversationId });
    if (!draft?.content) return null;
    const current = await draftQuery(context).first('provenance');
    if (current?.provenance?.kind !== 'conversation_synthesis') return null;
    const run = await tenantDb(context.trx, context.actor.tenant).table(TABLE).where({
      operation_id: current.provenance.operationId, ...binding(context), kind: 'synthesis', status: 'completed',
    }).first();
    if (!run || run.request_hash !== current.provenance.requestHash) return conflict();
    return { operationId: run.operation_id as string, source: snapshotConversationReference(run.request.source),
      sourceChanged: await synthesisSourceChanged(context, run.source_snapshot) };
  });
}
