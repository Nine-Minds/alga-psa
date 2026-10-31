'use client';

import type { CoManagedSharedResource } from '@alga-psa/co-managed';
import { PLAIN_TEXT_WRITER, registerFileStager, type FileStager } from './ticketCommentWriter';
import { prepareConversationDraft, submitConversationDraft } from './conversationDraftSubmission';
import type { StagedFile } from '@/lib/co-managed/attachmentStaging';

/** L4b's file stager for the plain-text writer: staged files become one operation-scoped draft
 * (begin -> upload each -> publish), and publish makes the single L4a writer call. The operation id
 * is the writer's, so a retry after an uncertain acknowledgement replays the stored receipt. */
export const stageConversationFiles: FileStager = async (input, message, operationId) => {
  const resource: CoManagedSharedResource = { ...input.resource };
  const files = (input.files?.() ?? []) as readonly StagedFile[];
  const parent = message.parentCommentId ? await input.parent(message.parentCommentId) : null;
  if (message.parentCommentId && !parent) return { ok: false, code: 'invalid' };
  const document = (await import('./conversationText')).conversationDocument(message.content);
  if (!document) return { ok: false, code: 'invalid' };
  const prepared = await prepareConversationDraft({ resource, actorTenant: input.context().actorTenant, operationId, document,
    audience: message.audience, ...(parent ? { parent } : {}), files: files.map(item => item.file) });
  const result = await submitConversationDraft(prepared, () => true, () => undefined);
  if (!result.ok) return { ok: false, code: result.code };
  const receipt = (result as { receipt: { commentId: string; storeTenant?: string; threadId?: string } }).receipt;
  return { ok: true, receipt: { commentId: receipt.commentId, storeTenant: receipt.storeTenant ?? prepared.storeTenant, threadId: receipt.threadId ?? '' } };
};

/** Idempotent; the shared-ticket composer calls it so a native page never registers a stager. */
export function registerCoManagedAttachmentStager(): void {
  registerFileStager(PLAIN_TEXT_WRITER, stageConversationFiles);
}
