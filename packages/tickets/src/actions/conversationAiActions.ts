'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedSharedWorkError, CoManagedAttachmentError, getNamedTicketConversation } from '@alga-psa/co-managed';
import { TicketConversationError, type ConversationTicketReference, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { ConversationAiError } from '@alga-psa/shared/lib/tickets/conversationAi';
import { coManagedBrowserActor } from '../lib/conversationBrowserActor';
import { prepareNamedConversationSynthesis, cancelNamedConversationSynthesis, getNamedConversationSynthesisStatus,
  getNamedConversationDraftSynthesis, type NamedConversationSynthesisRequest } from '../lib/prepareNamedConversationSynthesis';
import { getConversationAiSources } from '../lib/conversationAiContext';

function failure(error: unknown) {
  if (error instanceof ConversationAiError) return { ok: false as const, code: error.code };
  if (error instanceof TicketConversationError) return { ok: false as const, code: error.code === 'CONVERSATION_CONFLICT' ? 'conflict' as const
    : error.code === 'CONVERSATION_INVALID' ? 'invalid' as const : 'unavailable' as const };
  if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'unavailable' as const };
  if (error instanceof CoManagedAttachmentError) return { ok: false as const, code: 'invalid' as const };
  return { ok: false as const, code: 'unknown' as const };
}

export const getConversationAiCapabilityAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, source: TicketConversationReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    await getNamedTicketConversation(knex, actor, ticket, source);
    const { ticketConversationAiProvider } = await import('@product/chat/conversation-inference');
    await ticketConversationAiProvider.assertAvailable(actor);
    return { available: true };
  } catch { return { available: false }; }
});

export const prepareNamedConversationSynthesisAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, request: NamedConversationSynthesisRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const { ticketConversationAiProvider } = await import('@product/chat/conversation-inference');
    return { ok: true as const, result: await prepareNamedConversationSynthesis(knex, actor, ticket, destination, request, ticketConversationAiProvider) };
  } catch (error) { return failure(error); }
});

export const cancelNamedConversationSynthesisAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, result: await cancelNamedConversationSynthesis(knex, actor, ticket, destination, operationId) };
  } catch (error) { return failure(error); }
});

export const getNamedConversationSynthesisStatusAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, result: await getNamedConversationSynthesisStatus(knex, actor, ticket, destination, operationId) };
  } catch (error) { return failure(error); }
});

export const getNamedConversationDraftSynthesisAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, result: await getNamedConversationDraftSynthesis(knex, actor, ticket, destination) };
  } catch (error) { return failure(error); }
});

export const getConversationAiSourcesAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, sources: await getConversationAiSources(knex, actor, ticket, destination) };
  } catch (error) { return failure(error); }
});

export const invokeNamedConversationAiAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, request: import('../lib/invokeNamedConversationAi').NamedConversationAiRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const { ticketConversationAiProvider } = await import('@product/chat/conversation-inference');
    const { invokeNamedConversationAi } = await import('../lib/invokeNamedConversationAi');
    return { ok: true as const, result: await invokeNamedConversationAi(knex, actor, ticket, destination, request, ticketConversationAiProvider) };
  } catch (error) { return failure(error); }
});
export const cancelNamedConversationAiAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const { cancelNamedConversationAi } = await import('../lib/invokeNamedConversationAi');
    return { ok: true as const, result: await cancelNamedConversationAi(knex, actor, ticket, destination, operationId) };
  } catch (error) { return failure(error); }
});
export const getNamedConversationAiStatusAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  destination: TicketConversationReference, operationId: string) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const { getNamedConversationAiStatus } = await import('../lib/invokeNamedConversationAi');
    return { ok: true as const, result: await getNamedConversationAiStatus(knex, actor, ticket, destination, operationId) };
  } catch (error) { return failure(error); }
});
