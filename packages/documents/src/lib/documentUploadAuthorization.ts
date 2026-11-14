/**
 * The permission rules for uploading a document to a target entity, shared by `uploadDocument`
 * and the resumable upload route so both refuse the same callers with the same messages.
 *
 * Not part of the `'use server'` action module: it must not become a client-callable action.
 */
import type { Knex } from 'knex';
import type { IUser } from '@alga-psa/types';
import { hasPermission } from '@alga-psa/auth';
import { permissionError } from '@alga-psa/ui/lib/errorHandling';
import type { ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { canWriteAttachmentTicket, expireCommentAttachmentDrafts } from '@shared/lib/ticketCommentAttachments';
import { canUploadDocument, type DocumentUploadTarget } from './documentPermissions';

export interface DocumentUploadAuthorizationOptions extends DocumentUploadTarget {
  commentAttachmentDraft?: boolean;
}

/**
 * Resolves with `null` when `user` may upload to the target, or the same permission error
 * `uploadDocument` has always returned. A comment-attachment draft the user may not write to
 * throws `Permission denied: Cannot attach files to this ticket` (an authorization throw, which
 * callers map to a permission error), exactly as `uploadDocument` did before the extraction.
 * For a permitted draft it also expires stale drafts, as before.
 */
export async function assertDocumentUploadAllowed(
  user: IUser,
  tenant: string,
  knex: Knex,
  options: DocumentUploadAuthorizationOptions,
): Promise<ActionPermissionError | null> {
  if (!await canUploadDocument(user, options)) {
    return permissionError('Permission denied: Cannot create documents', 'documents:errors.permissions.create');
  }
  if (options.assetId && !await hasPermission(user, 'asset', 'update')) {
    return permissionError('Permission denied: Cannot update assets');
  }

  if (options.commentAttachmentDraft) {
    if (!options.ticketId || !await hasPermission(user, 'ticket', 'update') ||
        !await canWriteAttachmentTicket(knex, tenant, user.user_id, options.ticketId)) {
      throw new Error('Permission denied: Cannot attach files to this ticket');
    }
    await expireCommentAttachmentDrafts(knex, tenant);
  }
  return null;
}
