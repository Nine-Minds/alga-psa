'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { beginCoManagedConversationDraft, abandonCoManagedConversationDraft, uploadCoManagedDraftAttachment, publishCoManagedConversationDraft,
  CoManagedConversationDraftError, CoManagedAttachmentError, CoManagedSharedWorkError, CoManagedCommentCreateError, CoManagedPrivateCommentError,
  type CoManagedSharedResource, type CoManagedConversationDraftReference, type CoManagedConversationDraftRequest } from '@alga-psa/co-managed';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { coManagedAttachmentUploadLimit } from '../co-managed/attachmentUploadLimit';
import { uploadConversationAttachmentObject } from '../co-managed/conversationAttachments';
import { createSharedTicketComment } from '../co-managed/createTicketComment';

function failure(error: unknown) {
  if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
  if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' as const };
  if (error instanceof CoManagedConversationDraftError) return { ok: false as const,
    code: error.code === 'CONVERSATION_DRAFT_ABANDONED' ? 'abandoned' as const : error.code === 'CONVERSATION_DRAFT_NOT_READY' ? 'notReady' as const : error.code === 'CONVERSATION_DRAFT_CONFLICT' ? 'operationConflict' as const : 'invalid' as const };
  if (error instanceof CoManagedAttachmentError || error instanceof CoManagedCommentCreateError || error instanceof CoManagedPrivateCommentError)
    return { ok: false as const, code: error.code.includes('CONFLICT') ? 'operationConflict' as const : 'invalid' as const };
  return { ok: false as const, code: 'unknownOutcome' as const };
}
export const beginCoManagedConversationDraftAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, request: CoManagedConversationDraftRequest) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    if (!Array.isArray(request?.files) || request.files.some(file => !file || typeof file.size !== 'number' || file.size > coManagedAttachmentUploadLimit())) return { ok: false as const, code: 'invalid' as const };
    return { ok: true as const, draft: await beginCoManagedConversationDraft(knex, actor, resource, request) };
  } catch (error) { return failure(error); }
});
export const uploadCoManagedDraftAttachmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, reference: CoManagedConversationDraftReference,
  attachmentId: string, form: FormData) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || file.size > coManagedAttachmentUploadLimit()) return { ok: false as const, code: 'invalid' as const };
    const attachment = await uploadCoManagedDraftAttachment(knex, actor, resource, reference, attachmentId, new Uint8Array(await file.arrayBuffer()),
      (path, content, mimeType) => uploadConversationAttachmentObject(reference.storeTenant, path, content, mimeType));
    return { ok: true as const, attachment };
  } catch (error) { return failure(error); }
});
export const publishCoManagedConversationDraftAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, reference: CoManagedConversationDraftReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, receipt: await publishCoManagedConversationDraft(knex, actor, resource, reference, createSharedTicketComment) };
  } catch (error) { return failure(error); }
});

export const abandonCoManagedConversationDraftAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, reference: CoManagedConversationDraftReference) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    return { ok: true as const, result: await abandonCoManagedConversationDraft(knex, actor, resource, reference) };
  } catch (error) { return failure(error); }
});
