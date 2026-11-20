'use client';

import { useCallback, useRef, useState } from 'react';
import { isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { toast } from 'react-hot-toast';
import {
  createClipboardImageFilename,
  renameClipboardImageForUpload,
  validateClipboardImageFile,
} from './clipboardImageUtils';
import { resolveDocumentViewUrl as resolveDefaultDocumentViewUrl } from './documentViewUrl';

export type RichTextUploadScope =
  | { entityType: 'ticket'; entityId: string }
  | { entityType: 'project_task'; entityId: string };

export interface RichTextDraftClipboardImage {
  documentId: string;
  fileId: string;
  name: string;
  url: string;
}

interface UseRichTextUploadSessionOptions {
  componentLabel: string;
  commentAttachments?: boolean;
  scope?: RichTextUploadScope | null;
  userId?: string | null;
  trackDraftUploads: boolean;
  uploadsRestricted?: boolean;
  onDocumentsChanged?: () => Promise<void> | void;
  onDiscard: () => void;
  uploadDocumentAction?: (
    formData: FormData,
    params: { userId: string; ticketId?: string; projectTaskId?: string }
  ) => Promise<any>;
  resolveDocumentViewUrl?: (document: { document_id?: string; file_id?: string }) => string;
  deleteDraftUploadsAction?: (input: {
    scope: RichTextUploadScope;
    documentIds: string[];
  }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  discardCommentAttachmentDraftsAction?: (input: { ticketId: string; documentIds: string[] }) => Promise<{ deletedDocumentIds: string[]; failures: Array<{ documentId: string; reason: string }> }>;
  translate?: (key: string, options?: Record<string, unknown>) => string;
  toastApi?: Pick<typeof toast, 'error' | 'success'>;
}

export function useRichTextUploadSession({
  componentLabel,
  commentAttachments = false,
  scope,
  userId,
  trackDraftUploads,
  uploadsRestricted = false,
  onDocumentsChanged,
  onDiscard,
  uploadDocumentAction,
  resolveDocumentViewUrl,
  deleteDraftUploadsAction,
  discardCommentAttachmentDraftsAction,
  translate = (_key, options) => String(options?.defaultValue ?? _key),
  toastApi = toast,
}: UseRichTextUploadSessionOptions) {
  const [draftClipboardImages, setDraftClipboardImages] = useState<RichTextDraftClipboardImage[]>(
    []
  );
  const [showDraftCancelDialog, setShowDraftCancelDialog] = useState(false);
  const [isDeletingDraftImages, setIsDeletingDraftImages] = useState(false);
  const [pendingUploads, setPendingUploads] = useState(0);
  const clipboardUploadSequenceRef = useRef(0);
  const trackedRef = useRef<RichTextDraftClipboardImage[]>([]);
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
        scope,
        userId,
        error: refreshError,
      });
    }
  }, [componentLabel, onDocumentsChanged, scope, userId]);

  const performUpload = useCallback(
    async (file: File): Promise<string> => {
      if (!scope) {
        throw new Error('Upload scope is required for clipboard image upload.');
      }
      if (!userId) {
        throw new Error('User session is required for clipboard image upload.');
      }

      const validation = commentAttachments && !file.type.startsWith('image/') ? { valid: true, error: undefined } : validateClipboardImageFile(file);
      if (!validation.valid) {
        console.warn(`[${componentLabel}] Clipboard upload rejected by validation`, {
          scope,
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

      if (!uploadDocumentAction) throw new Error('A document upload action is required for rich-text uploads.');
      const uploadResult = await uploadDocumentAction(formData, {
        userId,
        ...(scope.entityType === 'ticket' ? { ticketId: scope.entityId } : { projectTaskId: scope.entityId }),
      });

      if (isActionPermissionError(uploadResult)) {
        const reason = uploadResult.permissionError || 'Clipboard image upload failed.';
        console.error(`[${componentLabel}] Clipboard image upload denied: ${reason}`, {
          scope,
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
          scope,
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
      // LEVERAGE: pattern document-open-url — resolveDocumentViewUrl now routes non-previewable files to /download itself; this local branch re-derives that decision.
      const viewUrl = commentAttachments && !file.type.startsWith('image/')
        ? `/api/documents/download/${uploadedDocument.file_id}`
        : resolveDocumentViewUrl
        ? resolveDocumentViewUrl(uploadedDocument)
        : resolveDefaultDocumentViewUrl(uploadedDocument);

      if (trackDraftUploads || commentAttachments) {
        if (!trackedRef.current.some(item => item.documentId === uploadedDocument.document_id)) {
          trackedRef.current.push({ documentId: uploadedDocument.document_id,
            fileId: uploadedDocument.file_id || '', name: uploadedDocument.document_name || fallbackName, url: viewUrl });
          setDraftClipboardImages([...trackedRef.current]);
        }
      }

      console.info(`[${componentLabel}] Clipboard image uploaded`, {
        scope,
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
      scope,
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
      scope,
      imageCount: draftClipboardImages.length,
    });
    setShowDraftCancelDialog(false);
    resetDraftTracking();
    onDiscard();
  }, [componentLabel, draftClipboardImages.length, onDiscard, resetDraftTracking, scope]);

  const deleteTrackedDraftClipboardImages = useCallback(async () => {
    if (commentAttachments) {
      cancellingRef.current = true;
      setIsDeletingDraftImages(true);
      await Promise.allSettled([...pendingRef.current]);
    } else if (pendingUploads > 0) return;
    const tracked = trackedRef.current;
    if (!scope) {
      toastApi.error('Upload scope is missing for draft image deletion.');
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
      const cleanupAction = commentAttachments && scope.entityType === 'ticket'
        ? discardCommentAttachmentDraftsAction
        : deleteDraftUploadsAction;
      if (!cleanupAction) {
        throw new Error('A draft upload cleanup action is required.');
      }
      const result = await (commentAttachments && scope.entityType === 'ticket'
        ? (cleanupAction as NonNullable<typeof discardCommentAttachmentDraftsAction>)({ ticketId: scope.entityId, documentIds: tracked.map(image => image.documentId) })
        : (cleanupAction as NonNullable<typeof deleteDraftUploadsAction>)({
        scope,
        documentIds: tracked.map((image) => image.documentId),
      }));

      const deletedCount = result.deletedDocumentIds.length;
      const failedCount = result.failures.length;

      console.info(`[${componentLabel}] Draft cancel action: delete uploaded clipboard images`, {
        scope,
        requestedCount: draftClipboardImages.length,
        deletedCount,
        failedCount,
        failures: result.failures,
      });

      if (deletedCount > 0) {
      toastApi.success(commentAttachments ? 'Draft attachments removed.' : translate('messages.pastedImagesDeleted', { defaultValue: `Deleted ${deletedCount} pasted images.`, count: deletedCount }));
        await refreshDocuments();
      }
      if (failedCount > 0) {
        toastApi.error(translate('messages.pastedImagesDeleteFailed', { defaultValue: `Could not delete ${failedCount} pasted images.`, count: failedCount }));
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
    deleteDraftUploadsAction,
    discardCommentAttachmentDraftsAction,
    translate,
    pendingUploads,
    commentAttachments,
    draftClipboardImages,
    onDiscard,
    refreshDocuments,
    resetDraftTracking,
    scope,
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
    // Typed as always-present for existing callers, who only hand it to an
    // editor prop; restricted comment editors receive undefined so the editor
    // offers no attachment UI at all.
    uploadFile: (uploadsRestricted ? undefined : uploadFile) as typeof uploadFile,
    deleteTrackedDraftClipboardImages,
  };
}
