'use client';

import { discardCommentAttachmentDrafts } from '../../actions/comment-actions/commentAttachmentDraftActions';
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import {
  createClipboardImageFilename,
  renameClipboardImageForUpload,
  validateClipboardImageFile,
} from '../../lib/clipboardImageUtils';
import { deleteDraftClipboardImages as deleteDraftClipboardImagesInternal } from '../../actions/comment-actions/clipboardImageDraftActions';

export interface TicketRichTextDraftClipboardImage {
  documentId: string;
  fileId: string;
  name: string;
  url: string;
}

interface UseTicketRichTextUploadSessionOptions {
  componentLabel: string;
  commentAttachments?: boolean;
  ticketId?: string | null;
  userId?: string | null;
  trackDraftUploads: boolean;
  onDocumentsChanged?: () => Promise<void> | void;
  onDiscard: () => void;
  uploadDocumentAction?: (
    formData: FormData,
    params: { userId: string; ticketId: string }
  ) => Promise<any>;
  resolveDocumentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  deleteDraftClipboardImagesAction?: (input: {
    ticketId: string;
    documentIds: string[];
  }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  deleteDocumentFn?: (documentId: string, userId: string) => Promise<{ success: boolean; deleted?: boolean; message?: string }>;
  toastApi?: Pick<typeof toast, 'error' | 'success'>;
}

export function useTicketRichTextUploadSession({
  componentLabel,
  commentAttachments = false,
  ticketId,
  userId,
  trackDraftUploads,
  onDocumentsChanged,
  onDiscard,
  uploadDocumentAction,
  resolveDocumentViewUrl,
  deleteDraftClipboardImagesAction,
  deleteDocumentFn,
  toastApi = toast,
}: UseTicketRichTextUploadSessionOptions) {
  const { t } = useTranslation('features/tickets');
  const [draftClipboardImages, setDraftClipboardImages] = useState<TicketRichTextDraftClipboardImage[]>(
    []
  );
  const [showDraftCancelDialog, setShowDraftCancelDialog] = useState(false);
  const [isDeletingDraftImages, setIsDeletingDraftImages] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const clipboardUploadSequenceRef = useRef(0);
  const trackedRef = useRef<TicketRichTextDraftClipboardImage[]>([]);
  const pendingRef = useRef(new Set<Promise<string>>());
  const cancellingRef = useRef(false);

  const resetDraftTracking = useCallback(() => {
    trackedRef.current = [];
    cancellingRef.current = false;
    setDraftClipboardImages([]);
    clipboardUploadSequenceRef.current = 0;
  }, []);

  const refreshDocuments = useCallback(async () => {
    if (!onDocumentsChanged) {
      return;
    }

    try {
      await Promise.resolve(onDocumentsChanged());
    } catch (refreshError) {
      console.error(`[${componentLabel}] Failed to refresh documents after clipboard upload`, {
        ticketId,
        userId,
        error: refreshError,
      });
    }
  }, [componentLabel, onDocumentsChanged, ticketId, userId]);

  const performUpload = useCallback(
    async (file: File): Promise<string> => {
      if (!ticketId) {
        throw new Error('Ticket ID is required for clipboard image upload.');
      }
      if (!userId) {
        throw new Error('User session is required for clipboard image upload.');
      }

      const validation = commentAttachments && !file.type.startsWith('image/') ? { valid: true, error: undefined } : validateClipboardImageFile(file);
      if (!validation.valid) {
        console.warn(`[${componentLabel}] Clipboard upload rejected by validation`, {
          ticketId,
          userId,
          mimeType: file.type,
          sizeBytes: file.size,
          reason: validation.error,
        });
        throw new Error(validation.error);
      }

      const sequence = (clipboardUploadSequenceRef.current += 1);
      const timestamp = new Date();
      const renamedFile = !file.type.startsWith('image/') ? file : renameClipboardImageForUpload({
        file,
        timestamp,
        sequence,
      });

      const formData = new FormData();
      formData.append('file', renamedFile);
      if (commentAttachments) formData.append('commentAttachmentDraft', 'true');

      const activeUploadDocumentAction =
        uploadDocumentAction ??
        (await import('@alga-psa/documents/actions/documentActions')).uploadDocument;
      const uploadResult = await activeUploadDocumentAction(formData, {
        userId,
        ticketId,
      });

      if (isActionPermissionError(uploadResult)) {
        const reason = uploadResult.permissionError || 'Clipboard image upload failed.';
        console.error(`[${componentLabel}] Clipboard image upload denied: ${reason}`, {
          ticketId,
          userId,
          sequence,
          fileName: renamedFile.name,
          mimeType: renamedFile.type,
          sizeBytes: renamedFile.size,
        });
        toastApi.error(reason);
        throw new Error(reason);
      }

      if (!uploadResult.success) {
        const reason =
          'error' in uploadResult && typeof uploadResult.error === 'string'
            ? uploadResult.error
            : 'Clipboard image upload failed.';
        console.error(`[${componentLabel}] Clipboard image upload failed: ${reason}`, {
          ticketId,
          userId,
          sequence,
          fileName: renamedFile.name,
          mimeType: renamedFile.type,
          sizeBytes: renamedFile.size,
          error: 'error' in uploadResult ? uploadResult.error : undefined,
        });
        toastApi.error(reason);
        throw new Error(reason);
      }

      const uploadedDocument = uploadResult.document;
      const fallbackName = createClipboardImageFilename({
        timestamp,
        sequence,
        mimeType: renamedFile.type,
      });
      const viewUrl = commentAttachments && !file.type.startsWith('image/')
        ? `/api/documents/download/${uploadedDocument.file_id}`
        : resolveDocumentViewUrl
        ? resolveDocumentViewUrl(uploadedDocument)
        : uploadedDocument.file_id
          ? `/api/documents/view/${uploadedDocument.file_id}`
          : `/api/documents/download/${uploadedDocument.document_id}`;

      if (trackDraftUploads || commentAttachments) {
        if (!trackedRef.current.some(item => item.documentId === uploadedDocument.document_id)) {
          trackedRef.current.push({ documentId: uploadedDocument.document_id,
            fileId: uploadedDocument.file_id || '', name: uploadedDocument.document_name || fallbackName, url: viewUrl });
          setDraftClipboardImages([...trackedRef.current]);
        }
      }

      console.info(`[${componentLabel}] Clipboard image uploaded`, {
        ticketId,
        userId,
        sequence,
        documentId: uploadedDocument.document_id,
        fileId: uploadedDocument.file_id,
        url: viewUrl,
      });

      await refreshDocuments();

      if (cancellingRef.current) throw new DOMException('Attachment upload canceled', 'AbortError');
      return viewUrl;
    },
    [
      componentLabel,
      commentAttachments,
      refreshDocuments,
      ticketId,
      toastApi,
      trackDraftUploads,
      uploadDocumentAction,
      resolveDocumentViewUrl,
      userId,
    ]
  );

  const uploadFile = useCallback(async (file: File) => {
    setPendingUploads(count => count + 1);
    if (cancellingRef.current) { setPendingUploads(count => count - 1); throw new Error('Draft cancellation is in progress'); }
    const pending = performUpload(file);
    pendingRef.current.add(pending);
    try { return await pending; }
    finally { pendingRef.current.delete(pending); setPendingUploads(count => count - 1); }
  }, [performUpload]);

  const requestDiscard = useCallback(() => {
    if (trackDraftUploads && draftClipboardImages.length > 0) {
      setShowDraftCancelDialog(true);
      return;
    }

    resetDraftTracking();
    onDiscard();
  }, [draftClipboardImages.length, onDiscard, resetDraftTracking, trackDraftUploads]);

  const keepDraftClipboardImages = useCallback(() => {
    console.info(`[${componentLabel}] Draft cancel action: keep uploaded clipboard images`, {
      ticketId,
      imageCount: draftClipboardImages.length,
    });
    setShowDraftCancelDialog(false);
    resetDraftTracking();
    onDiscard();
  }, [componentLabel, draftClipboardImages.length, onDiscard, resetDraftTracking, ticketId]);

  const deleteTrackedDraftClipboardImages = useCallback(async () => {
    if (commentAttachments) {
      cancellingRef.current = true;
      setIsDeletingDraftImages(true);
      await Promise.allSettled([...pendingRef.current]);
    } else if (pendingUploads > 0) return;
    const tracked = trackedRef.current;
    if (!ticketId) {
      toastApi.error('Ticket context is missing for draft image deletion.');
      return;
    }

    if (tracked.length === 0) {
      setIsDeletingDraftImages(false);
      setShowDraftCancelDialog(false);
      resetDraftTracking();
      onDiscard();
      return;
    }

    setIsDeletingDraftImages(true);
    try {
      if (!commentAttachments && !deleteDraftClipboardImagesAction && !deleteDocumentFn) {
        throw new Error('Either deleteDraftClipboardImagesAction or deleteDocumentFn is required for draft image cleanup');
      }
      const activeDeleteDraftClipboardImagesAction =
        (commentAttachments ? discardCommentAttachmentDrafts : deleteDraftClipboardImagesAction) ??
        ((input: { ticketId: string; documentIds: string[] }) =>
          deleteDraftClipboardImagesInternal({ ...input, deleteDocumentFn: deleteDocumentFn! }));
      const result = await activeDeleteDraftClipboardImagesAction({
        ticketId,
        documentIds: tracked.map((image) => image.documentId),
      });

      const deletedCount = result.deletedDocumentIds.length;
      const failedCount = result.failures.length;

      console.info(`[${componentLabel}] Draft cancel action: delete uploaded clipboard images`, {
        ticketId,
        requestedCount: draftClipboardImages.length,
        deletedCount,
        failedCount,
        failures: result.failures,
      });

      if (deletedCount > 0) {
        toastApi.success(commentAttachments ? 'Draft attachments removed.' : t('messages.pastedImagesDeleted', { defaultValue: 'Deleted {{count}} pasted images.', count: deletedCount }));
        await refreshDocuments();
      }
      if (failedCount > 0) {
        toastApi.error(t('messages.pastedImagesDeleteFailed', { defaultValue: 'Could not delete {{count}} pasted images.', count: failedCount }));
        if (commentAttachments) return;
      }

      setShowDraftCancelDialog(false);
      resetDraftTracking();
      onDiscard();
    } catch (error) {
      console.error(`[${componentLabel}] Failed deleting draft clipboard images:`, error);
      toastApi.error('Failed to delete pasted images.');
    } finally {
      cancellingRef.current = false;
      setIsDeletingDraftImages(false);
    }
  }, [
    componentLabel,
    deleteDraftClipboardImagesAction,
    pendingUploads,
    commentAttachments,
    draftClipboardImages,
    onDiscard,
    refreshDocuments,
    resetDraftTracking,
    ticketId,
    toastApi,
  ]);

  return {
    draftClipboardImages,
    isUploading: pendingUploads > 0,
    isDeletingDraftImages,
    keepDraftClipboardImages,
    requestDiscard: commentAttachments ? deleteTrackedDraftClipboardImages : requestDiscard,
    resetDraftTracking,
    showDraftCancelDialog,
    setShowDraftCancelDialog,
    uploadFile,
    deleteTrackedDraftClipboardImages,
  };
}
