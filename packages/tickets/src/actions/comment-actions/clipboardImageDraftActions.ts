'use server';

import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { withAuth, hasPermission } from '@alga-psa/auth';
import type { Knex } from 'knex';

type DraftClipboardImageDeleteFailureReason =
  | 'missing_document'
  | 'not_ticket_attachment'
  | 'has_other_associations'
  | 'not_owned_by_requester'
  | 'already_referenced'
  | 'not_image'
  | 'delete_failed';

interface DraftClipboardImageDeleteFailure {
  documentId: string;
  reason: DraftClipboardImageDeleteFailureReason;
  detail?: string;
}

type DeleteDocumentFn = (
  documentId: string,
  userId: string
) => Promise<{ success: boolean; deleted?: boolean; message?: string }>;

interface DeleteDraftClipboardImagesInput {
  ticketId: string;
  documentIds: string[];
  deleteDocumentFn: DeleteDocumentFn;
}

interface DeleteDraftClipboardImagesResult {
  deletedDocumentIds: string[];
  failures: DraftClipboardImageDeleteFailure[];
}

interface CandidateDocument {
  document_id: string;
  document_name: string;
  file_id: string | null;
  mime_type: string | null;
  created_by: string | null;
}

function isImageMimeType(mimeType: string | null): boolean {
  return Boolean(mimeType && mimeType.toLowerCase().startsWith('image/'));
}

export const deleteDraftClipboardImages = withAuth(
  async (
    user,
    { tenant },
    input: DeleteDraftClipboardImagesInput
  ): Promise<DeleteDraftClipboardImagesResult> => {
    if (!tenant) {
      throw new Error('Tenant is required.');
    }
    if (!input.ticketId) {
      throw new Error('ticketId is required.');
    }
    if (!Array.isArray(input.documentIds) || input.documentIds.length === 0) {
      return { deletedDocumentIds: [], failures: [] };
    }

    const hasDeletePermission = await hasPermission(user, 'document', 'delete');
    if (!hasDeletePermission) {
      throw new Error('Permission denied: cannot delete document attachments.');
    }

    const uniqueDocumentIds = Array.from(new Set(input.documentIds.filter(Boolean)));
    const { knex } = await createTenantKnex();

    const evaluation = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const candidates = await trx('documents as d')
        .join('document_associations as da', function joinAssociations() {
          this.on('da.document_id', '=', 'd.document_id').andOn('da.tenant', '=', 'd.tenant');
        })
        .where('d.tenant', tenant)
        .whereIn('d.document_id', uniqueDocumentIds)
        .andWhere('da.entity_type', 'ticket')
        .andWhere('da.entity_id', input.ticketId)
        .select<CandidateDocument[]>(
          'd.document_id',
          'd.document_name',
          'd.file_id',
          'd.mime_type',
          'd.created_by'
        );

      const byId = new Map(candidates.map((candidate) => [candidate.document_id, candidate]));
      const documentAssociations = await trx('document_associations')
        .select('document_id', 'entity_id', 'entity_type')
        .where('tenant', tenant)
        .whereIn('document_id', uniqueDocumentIds);
      const associationsByDocumentId = new Map<
        string,
        Array<{ entity_id: string; entity_type: string }>
      >();
      for (const association of documentAssociations) {
        const existing = associationsByDocumentId.get(association.document_id) || [];
        existing.push({
          entity_id: String(association.entity_id),
          entity_type: String(association.entity_type),
        });
        associationsByDocumentId.set(association.document_id, existing);
      }
      const failures: DraftClipboardImageDeleteFailure[] = [];
      const deletable: CandidateDocument[] = [];

      for (const requestedDocumentId of uniqueDocumentIds) {
        const candidate = byId.get(requestedDocumentId);
        if (!candidate) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'missing_document',
          });
          continue;
        }

        if (!isImageMimeType(candidate.mime_type)) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'not_image',
          });
          continue;
        }

        if (candidate.created_by !== user.user_id) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'not_owned_by_requester',
          });
          continue;
        }

        const associations = associationsByDocumentId.get(candidate.document_id) || [];
        const hasTicketAssociation = associations.some(
          (association) =>
            association.entity_type === 'ticket' && association.entity_id === String(input.ticketId)
        );
        if (!hasTicketAssociation) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'not_ticket_attachment',
          });
          continue;
        }
        const hasOtherAssociations = associations.some(
          (association) =>
            !(
              association.entity_type === 'ticket' &&
              association.entity_id === String(input.ticketId)
            )
        );
        if (hasOtherAssociations) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'has_other_associations',
          });
          continue;
        }

        const referenceTokens = [candidate.file_id, candidate.document_id].filter(Boolean) as string[];
        let referencedByComment = false;
        if (referenceTokens.length > 0) {
          const commentQuery = trx('comments')
            .where({ tenant })
            .andWhere(function containsReference() {
              referenceTokens.forEach((token, index) => {
                const pattern = `%${token}%`;
                if (index === 0) {
                  this.whereRaw('note::text LIKE ?', [pattern]);
                } else {
                  this.orWhereRaw('note::text LIKE ?', [pattern]);
                }
              });
            })
            .first('comment_id');

          const existingComment = await commentQuery;
          referencedByComment = Boolean(existingComment?.comment_id);
        }

        if (referencedByComment) {
          failures.push({
            documentId: requestedDocumentId,
            reason: 'already_referenced',
          });
          continue;
        }

        deletable.push(candidate);
      }

      return { deletable, failures };
    });

    const deletedDocumentIds: string[] = [];
    const failures = [...evaluation.failures];

    for (const candidate of evaluation.deletable) {
      const deleteResult = await input.deleteDocumentFn(candidate.document_id, user.user_id);
      if (deleteResult.success && deleteResult.deleted) {
        deletedDocumentIds.push(candidate.document_id);
        continue;
      }

      failures.push({
        documentId: candidate.document_id,
        reason: 'delete_failed',
        detail: deleteResult.message || 'Deletion failed.',
      });
    }

    console.info('[TicketCommentClipboardImageDraftDelete] Completed draft-image deletion request', {
      tenant,
      ticketId: input.ticketId,
      userId: user.user_id,
      requestedCount: uniqueDocumentIds.length,
      deletedCount: deletedDocumentIds.length,
      failureCount: failures.length,
      failures,
    });

    return {
      deletedDocumentIds,
      failures,
    };
  }
);
