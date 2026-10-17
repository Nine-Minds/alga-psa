'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { TicketConversationError, type TicketConversationReference } from '@alga-psa/shared/lib/tickets/namedConversations';
import { CoManagedAttachmentError, CoManagedSharedWorkError, listCoManagedConversationAttachments, canManageCoManagedConversationAttachments, removeCoManagedConversationAttachment,
  listNamedConversationAttachments, type CoManagedSharedResource, type CoManagedCommentReference, type CoManagedAttachmentReference } from '@alga-psa/co-managed';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { coManagedAttachmentUploadLimit } from '../co-managed/attachmentUploadLimit';
import { uploadConversationAttachment } from '../co-managed/conversationAttachments';

export const listCoManagedAttachmentsAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, comment: CoManagedCommentReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listCoManagedConversationAttachments(knex, actor, resource, comment);
});
export const getCoManagedAttachmentsScreenAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, comment: CoManagedCommentReference, conversation?: TicketConversationReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  if (conversation && conversation.storeTenant !== comment.storeTenant) throw new TicketConversationError('CONVERSATION_FORBIDDEN');
  // Acquire update hints before the separate read transaction, avoiding a lock upgrade.
  const canManage = await canManageCoManagedConversationAttachments(knex, actor, resource, comment);
  const managed = await listCoManagedConversationAttachments(knex, actor, resource, comment);
  const attachments = conversation ? await listNamedConversationAttachments(knex, actor,
    { tenant: resource.tenant, ticketId: resource.id, relationshipId: resource.relationshipId }, conversation, comment) : managed;
  const maxBytes = coManagedAttachmentUploadLimit();
  return { attachments, canUpload: canManage && maxBytes > 0, canRemove: canManage,
    removableAttachmentIds: canManage ? managed.map(file => file.attachmentId) : [], maxBytes, actor: { tenant: actor.tenant, userId: actor.userId } };
});
export const uploadCoManagedAttachmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  comment: CoManagedCommentReference, attachmentId: string, form: FormData) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || file.size > coManagedAttachmentUploadLimit()) return { ok: false as const, code: 'invalid' as const };
    const attachment = await uploadConversationAttachment(knex, actor, resource, { attachmentId, comment, fileName: file.name,
      mimeType: file.type || 'application/octet-stream', content: new Uint8Array(await file.arrayBuffer()) });
    return { ok: true as const, attachment };
  } catch (error) {
    return attachmentFailure(error);
  }
});

function attachmentFailure(error: unknown) {
  if (error instanceof CoManagedAttachmentError) return { ok: false as const, code: error.code === 'ATTACHMENT_OPERATION_CONFLICT' ? 'operationConflict' as const : 'invalid' as const };
  if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
  if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' as const };
  return { ok: false as const, code: 'unknownOutcome' as const };
}

export const removeCoManagedAttachmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, attachment: CoManagedAttachmentReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, receipt: await removeCoManagedConversationAttachment(knex, actor, resource, attachment) };
  } catch (error) { return attachmentFailure(error); }
});
