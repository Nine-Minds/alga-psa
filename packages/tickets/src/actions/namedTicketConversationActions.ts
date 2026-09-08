'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { listNamedTicketConversationOverview, listNamedTicketConversations, getNamedTicketConversation, createNamedTicketConversation, setNamedTicketConversationStatus,
  getNamedConversationEditorDraft, saveNamedConversationEditorDraft, getNamedTicketConversationWriteAudiences, getNamedTicketConversationMessages, getNamedTicketConversationActivity, type CoManagedConversationCursor } from '@alga-psa/co-managed';
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
    listNamedTicketConversationOverview(knex, actor, ticket), getNamedTicketConversationWriteAudiences(knex, actor, ticket),
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

export const prepareNamedTicketEmailAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference,
  request: import('@alga-psa/co-managed').NamedConversationEmailRequest) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { prepareNamedTicketEmail } = await import('../lib/namedConversationEmail');
  return prepareNamedTicketEmail(knex, actor, ticket, conversation, request);
});
export const sendNamedTicketEmailAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference,
  operationId: string, reviewHash: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { sendNamedTicketEmail } = await import('../lib/namedConversationEmail');
  return sendNamedTicketEmail(knex, actor, ticket, conversation, operationId, reviewHash);
});
export const getNamedTicketEmailOperationAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference, operationId: string) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedConversationEmailOperation } = await import('@alga-psa/co-managed');
  return getNamedConversationEmailOperation(knex, actor, ticket, conversation, operationId);
});

export const getLatestNamedTicketEmailSendAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getLatestNamedConversationEmailSend } = await import('@alga-psa/co-managed');
  return getLatestNamedConversationEmailSend(knex, actor, ticket, conversation);
});

export const getNamedConversationEmailDefaultsAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedConversationEmailDefaults } = await import('@alga-psa/co-managed');
  return getNamedConversationEmailDefaults(knex, actor, ticket, conversation);
});


export const getNamedConversationUploadOptionsAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  await getNamedTicketConversation(knex, actor, ticket, conversation);
  const { coManagedAttachmentUploadLimit } = await import('../lib/conversationAttachmentUploadLimit');
  return { maxBytes: coManagedAttachmentUploadLimit() };
});
export const uploadNamedConversationEditorFileAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, attachmentId: string, form: FormData) => {
  const { uploadNamedConversationEditorFile, CoManagedAttachmentError, CoManagedSharedWorkError } = await import('@alga-psa/co-managed');
  const { TicketConversationError } = await import('@alga-psa/shared/lib/tickets/namedConversations');
  const { coManagedAttachmentUploadLimit } = await import('../lib/conversationAttachmentUploadLimit');
  const { namedConversationFileStorage } = await import('../lib/conversationFileStorage');
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || file.size > coManagedAttachmentUploadLimit()) return { ok: false as const, code: 'invalid' as const };
    const attachment = await uploadNamedConversationEditorFile(knex, actor, ticket, conversation,
      { attachmentId, fileName: file.name, mimeType: file.type || 'application/octet-stream', content: new Uint8Array(await file.arrayBuffer()) },
      (path, bytes, mime) => namedConversationFileStorage.upload(actor.tenant, path, bytes, mime));
    return { ok: true as const, attachment };
  } catch (error) {
    if (error instanceof CoManagedAttachmentError) return { ok: false as const, code: 'invalid' as const };
    if (error instanceof TicketConversationError || error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
    return { ok: false as const, code: 'unknownOutcome' as const };
  }
});

export const getNamedTicketConversationActivityAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, before?: CoManagedConversationCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return getNamedTicketConversationActivity(knex, actor, ticket, before);
});

export const getNamedTicketConversationReplyTargetAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, parent: import('@alga-psa/shared/lib/tickets/conversationEditorDrafts').ConversationDraftParent) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedTicketConversationReplyTarget } = await import('@alga-psa/co-managed');
  return getNamedTicketConversationReplyTarget(knex, actor, ticket, conversation, parent);
});

export const getNamedTicketConversationPublicationCapabilitiesAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedTicketConversationPublicationCapabilities } = await import('@alga-psa/co-managed');
  return getNamedTicketConversationPublicationCapabilities(knex, actor, ticket, conversation);
});

export const listNamedScheduledCommentsAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, after?: import('@alga-psa/co-managed').NamedScheduleCursor) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { listNamedScheduledComments } = await import('@alga-psa/co-managed');
  return listNamedScheduledComments(knex, actor, ticket, conversation, after);
});

export const getNamedConversationMessageDetailsAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, comments: { commentId: string; threadId: string }[]) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedConversationMessageDetails } = await import('@alga-psa/co-managed');
  return getNamedConversationMessageDetails(knex, actor, ticket, conversation, comments);
});

export const getNamedConversationAttentionAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference, conversation: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { getNamedConversationAttention } = await import('@alga-psa/co-managed');
  return getNamedConversationAttention(knex, actor, ticket, conversation);
});
export const updateNamedConversationPreferenceAction = withAuth(async (user, { tenant }, ticket: ConversationTicketReference,
  conversation: TicketConversationReference, preference: { following?: boolean; readThrough?: string }) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  const { updateNamedConversationPreference } = await import('@alga-psa/co-managed');
  return updateNamedConversationPreference(knex, actor, ticket, conversation, preference);
});
