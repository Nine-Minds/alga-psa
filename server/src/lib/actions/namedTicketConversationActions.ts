'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { listNamedTicketConversations, getNamedTicketConversation, createNamedTicketConversation, setNamedTicketConversationStatus,
  getNamedConversationEditorDraft, saveNamedConversationEditorDraft, getNamedTicketConversationMessages, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import type { CoManagedConversationContent } from '@alga-psa/co-managed/conversationContent';
import type { ConversationTicketReference, TicketConversationReference, CreateTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { coManagedBrowserActor } from '../co-managed/browserActor';

// The release flag belongs to the UI. These commands always enforce the current
// home session, qualified ticket access, content audience and lifecycle.
export const listNamedTicketConversationsAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listNamedTicketConversations(knex, actor, ticket);
});
export const getNamedTicketConversationAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getNamedTicketConversation(knex, actor, ticket, conversation);
});
export const createNamedTicketConversationAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, request: CreateTicketConversation) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return createNamedTicketConversation(knex, actor, ticket, request);
});
export const setNamedTicketConversationStatusAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, expectedRevision: number, status: 'open' | 'done') => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return setNamedTicketConversationStatus(knex, actor, ticket, conversation, expectedRevision, status);
});

export const getNamedConversationEditorDraftAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getNamedConversationEditorDraft(knex, actor, ticket, conversation);
});
export const saveNamedConversationEditorDraftAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, request: EditorDraftSaveRequest<CoManagedConversationContent>) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return saveNamedConversationEditorDraft(knex, actor, ticket, conversation, request);
});

export const getNamedTicketConversationMessagesAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getNamedTicketConversationMessages(knex, actor, ticket, conversation, before);
});
