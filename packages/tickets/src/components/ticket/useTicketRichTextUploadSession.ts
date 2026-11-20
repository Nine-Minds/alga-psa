'use client';

import { useTicketDataSource } from './TicketDataSourceContext';
import { useCallback } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useRichTextUploadSession, type RichTextDraftClipboardImage } from '@alga-psa/ui/editor';
import { toast } from 'react-hot-toast';

export type TicketRichTextDraftClipboardImage = RichTextDraftClipboardImage;

interface UseTicketRichTextUploadSessionOptions {
  componentLabel: string;
  commentAttachments?: boolean;
  ticketId?: string | null;
  userId?: string | null;
  trackDraftUploads: boolean;
  onDocumentsChanged?: () => Promise<void> | void;
  onDiscard: () => void;
  uploadDocumentAction?: (formData: FormData, params: { userId: string; ticketId: string }) => Promise<any>;
  resolveDocumentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  deleteDraftClipboardImagesAction?: (input: { ticketId: string; documentIds: string[] }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  deleteDocumentFn?: (documentId: string, userId: string) => Promise<{ success: boolean; deleted?: boolean; message?: string }>;
  toastApi?: Pick<typeof toast, 'error' | 'success'>;
}

export function useTicketRichTextUploadSession(options: UseTicketRichTextUploadSessionOptions) {
  const source = useTicketDataSource();
  const { t } = useTranslation('features/tickets');
  const scope = options.ticketId ? { entityType: 'ticket' as const, entityId: options.ticketId } : null;
  const uploadDocumentAction = async (formData: FormData, params: { userId: string; ticketId?: string; projectTaskId?: string }) => {
    if (!params.ticketId) throw new Error('Ticket upload requires a ticket scope.');
    if (options.uploadDocumentAction) return options.uploadDocumentAction(formData, { userId: params.userId, ticketId: params.ticketId });
    const { uploadDocument } = await import('@alga-psa/documents/actions/documentActions');
    return uploadDocument(formData, { userId: params.userId, ticketId: params.ticketId });
  };

  const session = useRichTextUploadSession({
    componentLabel: options.componentLabel,
    commentAttachments: options.commentAttachments,
    scope,
    userId: options.userId,
    trackDraftUploads: options.trackDraftUploads,
    uploadsRestricted: Boolean(options.commentAttachments && (
      source.conversation.editor?.disallowImages || source.conversation.editor?.disallowFiles
    )),
    onDocumentsChanged: options.onDocumentsChanged,
    onDiscard: options.onDiscard,
    uploadDocumentAction,
    resolveDocumentViewUrl: options.resolveDocumentViewUrl,
    deleteDraftUploadsAction: options.deleteDraftClipboardImagesAction
      ? async ({ scope: draftScope, documentIds }) => {
          if (draftScope.entityType !== 'ticket') throw new Error('Ticket cleanup received a non-ticket scope.');
          return options.deleteDraftClipboardImagesAction!({ ticketId: draftScope.entityId, documentIds });
        }
      : async ({ scope: draftScope, documentIds }) => {
          if (draftScope.entityType !== 'ticket') throw new Error('Ticket cleanup received a non-ticket scope.');
          return source.comments.deleteDraftClipboardImages({
            ticketId: draftScope.entityId,
            documentIds,
            deleteDocumentFn: options.deleteDocumentFn!,
          });
        },
    discardCommentAttachmentDraftsAction: input => source.comments.discardCommentAttachmentDrafts(input),
    translate: (key, params) => String(t(key, params as any)),
    toastApi: options.toastApi,
  });
  const uploadFile = useCallback(async (file: File) => {
    if (!options.ticketId) throw new Error('Ticket ID is required for clipboard image upload.');
    return session.uploadFile(file);
  }, [options.ticketId, session.uploadFile]);
  return { ...session, uploadFile };
}
