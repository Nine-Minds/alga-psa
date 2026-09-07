'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import { CoManagedAttachmentError, CoManagedSharedWorkError, listCoManagedConversationAttachments,
  type CoManagedSharedResource, type CoManagedCommentReference } from '@alga-psa/co-managed';
import { CoManagedLifecycleError } from '@alga-psa/licensing';
import { coManagedBrowserActor } from '../co-managed/browserActor';
import { uploadConversationAttachment } from '../co-managed/conversationAttachments';

export const listCoManagedAttachmentsAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource, comment: CoManagedCommentReference) => {
  const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
  return listCoManagedConversationAttachments(knex, actor, resource, comment);
});
export const uploadCoManagedAttachmentAction = withAuth(async (user, { tenant }, resource: CoManagedSharedResource,
  comment: CoManagedCommentReference, attachmentId: string, form: FormData) => {
  try {
    const actor = await coManagedBrowserActor(user, tenant), { knex } = await createTenantKnex(tenant);
    const file = form.get('file');
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function' || file.size > 26214400) return { ok: false as const, code: 'invalid' as const };
    const attachment = await uploadConversationAttachment(knex, actor, resource, { attachmentId, comment, fileName: file.name,
      mimeType: file.type || 'application/octet-stream', content: new Uint8Array(await file.arrayBuffer()) });
    return { ok: true as const, attachment };
  } catch (error) {
    if (error instanceof CoManagedAttachmentError) return { ok: false as const, code: error.code === 'ATTACHMENT_OPERATION_CONFLICT' ? 'operationConflict' as const : 'invalid' as const };
    if (error instanceof CoManagedSharedWorkError) return { ok: false as const, code: 'forbidden' as const };
    if (error instanceof CoManagedLifecycleError) return { ok: false as const, code: 'readOnly' as const };
    return { ok: false as const, code: 'unknownOutcome' as const };
  }
});
