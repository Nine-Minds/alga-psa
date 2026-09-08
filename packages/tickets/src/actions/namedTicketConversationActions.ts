'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { listNamedTicketConversations, getNamedTicketConversation, createNamedTicketConversation, setNamedTicketConversationStatus,
  getNamedConversationEditorDraft, saveNamedConversationEditorDraft, getNamedTicketConversationWriteAudiences, getNamedTicketConversationMessages, type CoManagedConversationCursor } from '@alga-psa/co-managed';
import type { CoManagedConversationContent } from '@alga-psa/co-managed/conversationContent';
import type { ConversationTicketReference, TicketConversationReference, CreateTicketConversation } from '@alga-psa/shared/lib/tickets/namedConversations';
import type { EditorDraftSaveRequest } from '@alga-psa/shared/lib/tickets/conversationEditorDrafts';
import { coManagedBrowserActor } from '../lib/conversationBrowserActor';

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

export const postNamedTicketConversationAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, request: import('@alga-psa/co-managed').NamedConversationPostRequest) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { postNamedTicketConversation } = await import('../lib/postNamedTicketConversation');
  return postNamedTicketConversation(knex, actor, ticket, conversation, request);
});


export const getNamedTicketConversationScreenAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const [conversations, writeAudiences] = await Promise.all([
    listNamedTicketConversations(knex, actor, ticket), getNamedTicketConversationWriteAudiences(knex, actor, ticket),
  ]);
  return { conversations, writeAudiences, actor: { tenant: actor.tenant, userId: actor.userId } };
});

export const listNamedConversationMailboxesAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { listNamedConversationMailboxes } = await import('@alga-psa/co-managed');
  return listNamedConversationMailboxes(knex, actor, ticket, conversation);
});
export const selectNamedConversationMailboxAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference,
  expectedRevision: number, mailboxId: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { selectNamedConversationMailbox } = await import('@alga-psa/co-managed');
  return selectNamedConversationMailbox(knex, actor, ticket, conversation, expectedRevision, mailboxId);
});
export const setNamedConversationSenderGrantAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference,
  request: Parameters<typeof import('@alga-psa/co-managed').setNamedConversationSenderGrant>[4]) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { setNamedConversationSenderGrant } = await import('@alga-psa/co-managed');
  return setNamedConversationSenderGrant(knex, actor, ticket, conversation, request);
});
