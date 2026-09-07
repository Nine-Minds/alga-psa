'use client';

import type { CoManagedSharedResource, CoManagedConversationDraftRequest, CoManagedCommentReference } from '@alga-psa/co-managed';
import { snapshotConversationDocument, type CoManagedRichTextDocument } from '@alga-psa/co-managed/conversationRichText';
import { beginCoManagedConversationDraftAction, uploadCoManagedDraftAttachmentAction, publishCoManagedConversationDraftAction } from '@/lib/actions/coManagedConversationDraftActions';
type Audience = NonNullable<CoManagedConversationDraftRequest['audience']>;
export interface PreparedConversationDraft {
  resource: CoManagedSharedResource; storeTenant: string; request: CoManagedConversationDraftRequest;
  files: Array<{ attachmentId: string; file: File }>;
}
export interface ConversationDraftProgress { phase: 'preparing' | 'uploading' | 'publishing'; completed: number; total: number }
export async function prepareConversationDraft(input: { resource: CoManagedSharedResource; actorTenant: string; operationId: string;
  document: CoManagedRichTextDocument; audience: Audience; parent?: CoManagedCommentReference; files: File[] }): Promise<PreparedConversationDraft> {
  // Capture intent before asynchronous file hashing. Native File objects are immutable.
  const resource = { ...input.resource }, operationId = input.operationId, audience = input.audience;
  const content = { document: snapshotConversationDocument(input.document) }, parent = input.parent ? { ...input.parent } : undefined;
  const storeTenant = parent?.storeTenant ?? (audience === 'organization_private' && input.actorTenant !== resource.tenant ? input.actorTenant : resource.tenant);
  const files = input.files.map(file => ({ file, attachmentId: crypto.randomUUID() }));
  const manifest: CoManagedConversationDraftRequest['files'] = [];
  for (const { file, attachmentId } of files) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    manifest.push({ attachmentId, fileName: file.name, mimeType: file.type || 'application/octet-stream', size: file.size,
      contentHash: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('') });
  }
  return { resource, storeTenant, files, request: { operationId, content, files: manifest, ...(parent ? { parent, expectedAudience: audience } : { audience }) } };
}
/** Each retry asks the server which immutable files are ready, then publishes.
 * Never allocate fresh operation IDs after an uncertain network response. */
export async function submitConversationDraft(prepared: PreparedConversationDraft, current: () => boolean,
  progress: (value: ConversationDraftProgress) => void) {
  const stopped = { ok: false as const, code: 'aborted' as const };
  if (!current()) return stopped;
  progress({ phase: 'preparing', completed: 0, total: prepared.files.length });
  const begun = await beginCoManagedConversationDraftAction(prepared.resource, prepared.request);
  if (!current()) return stopped;
  if (!begun.ok) return begun;
  if (begun.draft.operationId !== prepared.request.operationId || begun.draft.storeTenant !== prepared.storeTenant ||
      !['draft', 'published'].includes(begun.draft.status) || begun.draft.uploadedAttachmentIds.some(id => !prepared.files.some(file => file.attachmentId === id))) throw new Error('Unexpected draft identity');
  const reference = { storeTenant: prepared.storeTenant, operationId: prepared.request.operationId };
  if (begun.draft.status !== 'published') {
    const ready = new Set(begun.draft.uploadedAttachmentIds);
    for (const item of prepared.files) {
      if (!current()) return stopped;
      if (ready.has(item.attachmentId)) continue;
      progress({ phase: 'uploading', completed: ready.size, total: prepared.files.length });
      const form = new FormData(); form.append('file', item.file);
      const result = await uploadCoManagedDraftAttachmentAction(prepared.resource, reference, item.attachmentId, form);
      if (!current()) return stopped;
      if (!result.ok) return result;
      ready.add(item.attachmentId);
    }
  }
  if (!current()) return stopped;
  progress({ phase: 'publishing', completed: prepared.files.length, total: prepared.files.length });
  return publishCoManagedConversationDraftAction(prepared.resource, reference);
}
