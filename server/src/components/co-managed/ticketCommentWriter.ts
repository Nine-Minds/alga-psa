'use client';

import type { CoManagedSharedResource, CoManagedCommentReference } from '@alga-psa/co-managed';
import type { CommentAudience } from '@alga-psa/shared/lib/commentAudience';
import type { AttachmentStaging } from '@/lib/co-managed/attachmentStaging';
import { createCoManagedTicketCommentAction } from '@/lib/actions/coManagedTicketCommentActions';
import { saveCoManagedPrivateTicketCommentAction } from '@/lib/actions/coManagedPrivateTicketCommentActions';
import { conversationDocument } from './conversationText';
import { newCoManagedOperationId } from './coManagedOperationId';
import { prepareConversationDraft, submitConversationDraft, type PreparedConversationDraft } from './conversationDraftSubmission';

type Receipt = { commentId: string; storeTenant: string; threadId: string };
type Result = { ok: false; code: string } | { ok: true; receipt: Receipt };
export type TicketCommentWriteContext = {
  canWrite: boolean;
  actorTenant: string;
  writeAudiences: readonly CommentAudience[];
  draftAttachments: { maxFiles: number; maxBytes: number; audiences: readonly CommentAudience[] };
};
export class TicketCommentWriteError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** One captured message intent, shared by native customer and qualified MSP
 * composers. The server admits every command; this retains the same operation
 * and prepared files across uncertain acknowledgments. */
export function createTicketCommentWriter(input: {
  resource: CoManagedSharedResource;
  context: () => TicketCommentWriteContext;
  parent: (commentId: string) => CoManagedCommentReference | null | Promise<CoManagedCommentReference | null>;
  staging: AttachmentStaging;
}) {
  const resource = { ...input.resource };
  let pending: { key: string; id: string; prepared?: PreparedConversationDraft } | null = null;
  return async (message: { content: string; audience: CommentAudience; parentCommentId?: string }): Promise<Receipt> => {
    const fail = (code: string): never => { throw new TicketCommentWriteError(code); };
    const context = input.context();
    if (!context.canWrite || !context.writeAudiences.includes(message.audience)) fail('forbidden');
    const document = conversationDocument(message.content) ?? fail('invalid');
    const parent = message.parentCommentId ? await input.parent(message.parentCommentId) ?? fail('invalid') : undefined;
    const files = input.staging.getSnapshot();
    const limits = context.draftAttachments;
    if (files.length && (!limits.audiences.includes(message.audience) || files.length > limits.maxFiles || files.some(({ file }) => file.size > limits.maxBytes))) fail('invalid');
    // Selection keys distinguish replacement files even when their metadata is identical.
    const key = JSON.stringify([message.content, message.audience, parent ?? null, files.map(file => file.key)]);
    if (pending?.key !== key) pending = { key, id: newCoManagedOperationId() };
    const operation = pending;
    let result: Result;
    try {
      if (files.length) {
        operation.prepared ??= await prepareConversationDraft({ resource, actorTenant: context.actorTenant, operationId: operation.id,
          document, audience: message.audience, parent, files: files.map(item => item.file) });
        result = await submitConversationDraft(operation.prepared, () => true, () => {}) as Result;
      } else if (context.actorTenant !== resource.tenant && message.audience === 'organization_private') {
        result = await saveCoManagedPrivateTicketCommentAction(resource, { kind: 'create', operationId: operation.id, document, ...(parent ? { parent } : {}) }) as Result;
      } else {
        result = await createCoManagedTicketCommentAction(resource, parent
          ? { operationId: operation.id, document, parent, expectedAudience: message.audience }
          : { operationId: operation.id, document, audience: message.audience }) as Result;
      }
    } catch { return fail('unknownOutcome'); }
    if (!result.ok) {
      if (result.code !== 'unknownOutcome' && result.code !== 'notReady' && pending === operation) pending = null;
      return fail(result.code);
    }
    if (pending === operation) pending = null;
    for (const file of files) input.staging.remove(file.key);
    return result.receipt;
  };
}
