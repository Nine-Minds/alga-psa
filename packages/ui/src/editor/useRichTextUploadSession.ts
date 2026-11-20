'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  const [pendingUploadsByScope, setPendingUploadsByScope] = useState<Record<string, number>>({});
  const scopeKey = scope ? `${scope.entityType}:${scope.entityId}` : 'none';
  const clipboardUploadSequenceRef = useRef(0);
  const trackedByScopeRef = useRef(new Map<string, RichTextDraftClipboardImage[]>());
  const pendingByScopeRef = useRef(new Map<string, Set<Promise<string>>>());
  const cancellingScopesRef = useRef(new Set<string>());
  const scopeRef = useRef(scope);
  const scopeKeyRef = useRef(scopeKey);
  scopeRef.current = scope;
  scopeKeyRef.current = scopeKey;
  const pendingUploads = pendingUploadsByScope[scopeKey] ?? 0;

  const getTracked = (key: string) => trackedByScopeRef.current.get(key) ?? [];
  const setTracked = (key: string, uploads: RichTextDraftClipboardImage[]) => {
    trackedByScopeRef.current.set(key, uploads);
    if (scopeKeyRef.current === key) setDraftClipboardImages([...uploads]);
  };
  const addPending = (key: string, amount: number) => setPendingUploadsByScope(current => {
    const next = { ...current, [key]: Math.max(0, (current[key] ?? 0) + amount) };
    if (next[key] === 0) delete next[key];
    return next;
  });
  const pendingFor = (key: string) => pendingByScopeRef.current.get(key) ?? new Set<Promise<string>>();

  useEffect(() => {
    setDraftClipboardImages([...getTracked(scopeKey)]);
  }, [scopeKey]);

  const resetDraftTracking = useCallback(() => {
    trackedByScopeRef.current.delete(scopeKey);
    cancellingScopesRef.current.delete(scopeKey);
    setDraftClipboardImages([]);
    clipboardUploadSequenceRef.current = 0;
  }, [scopeKey]);

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
    async (file: File, uploadScope: RichTextUploadScope | null | undefined, uploadScopeKey: string): Promise<string> => {
      if (!uploadScope) {
        throw new Error('Upload scope is required for clipboard image upload.');
      }
      if (!userId) {
        throw new Error('User session is required for clipboard image upload.');
      }

      const validation = commentAttachments && !file.type.startsWith('image/') ? { valid: true, error: undefined } : validateClipboardImageFile(file);
      if (!validation.valid) {
        console.warn(`[${componentLabel}] Clipboard upload rejected by validation`, {
          scope: uploadScope,
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
        ...(uploadScope.entityType === 'ticket' ? { ticketId: uploadScope.entityId } : { projectTaskId: uploadScope.entityId }),
      });

      if (isActionPermissionError(uploadResult)) {
        const reason = uploadResult.permissionError || 'Clipboard image upload failed.';
        console.error(`[${componentLabel}] Clipboard image upload denied: ${reason}`, {
          scope: uploadScope,
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
          scope: uploadScope,
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
        const tracked = getTracked(uploadScopeKey);
        if (!tracked.some(item => item.documentId === uploadedDocument.document_id)) {
          tracked.push({ documentId: uploadedDocument.document_id,
            fileId: uploadedDocument.file_id || '', name: uploadedDocument.document_name || fallbackName, url: viewUrl });
          setTracked(uploadScopeKey, tracked);
        }
      }

      console.info(`[${componentLabel}] Clipboard image uploaded`, {
        scope: uploadScope,
        userId,
        sequence,
        documentId: uploadedDocument.document_id,
        fileId: uploadedDocument.file_id,
        url: viewUrl,
      });

      await refreshDocuments();

      if (cancellingScopesRef.current.has(uploadScopeKey)) throw new DOMException('Attachment upload canceled', 'AbortError');
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

  const performUploadRef = useRef(performUpload);
  performUploadRef.current = performUpload;

  const uploadFile = useCallback(async (file: File) => {
    addPending(scopeKey, 1);
    if (cancellingScopesRef.current.has(scopeKey)) { addPending(scopeKey, -1); throw new Error('Draft cancellation is in progress'); }
    const pending = performUploadRef.current(file, scope, scopeKey);
    const pendingForScope = pendingFor(scopeKey);
    pendingForScope.add(pending);
    pendingByScopeRef.current.set(scopeKey, pendingForScope);
    try { return await pending; }
    finally { pendingForScope.delete(pending); addPending(scopeKey, -1); }
  }, [scope, scopeKey]);

  const cleanupUploads = useCallback(async (uploads: RichTextDraftClipboardImage[], targetScope = scope) => {
    if (!uploads.length || !targetScope) return { deletedDocumentIds: [], failures: [] };
    const cleanupAction = commentAttachments && targetScope.entityType === 'ticket'
      ? discardCommentAttachmentDraftsAction
      : deleteDraftUploadsAction;
    if (!cleanupAction) throw new Error('A draft upload cleanup action is required.');
    return commentAttachments && targetScope.entityType === 'ticket'
      ? (cleanupAction as NonNullable<typeof discardCommentAttachmentDraftsAction>)(
          { ticketId: targetScope.entityId, documentIds: uploads.map(image => image.documentId) }
        )
      : (cleanupAction as NonNullable<typeof deleteDraftUploadsAction>)(
          { scope: targetScope, documentIds: uploads.map(image => image.documentId) }
        );
  }, [commentAttachments, deleteDraftUploadsAction, discardCommentAttachmentDraftsAction, scope]);
  const cleanupUploadsRef = useRef(cleanupUploads);
  cleanupUploadsRef.current = cleanupUploads;

  const reconcileDraftUploads = useCallback(async (savedContent: string) => {
    const referencedIds = new Set(Array.from(
      savedContent.matchAll(/(?:\/api\/documents\/(?:view|download)\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi),
      match => match[1].toLowerCase()
    ));
    const tracked = getTracked(scopeKey);
    const committed = tracked.filter(image => referencedIds.has(image.fileId.toLowerCase()) || referencedIds.has(image.documentId.toLowerCase()));
    const abandoned = tracked.filter(image => !committed.includes(image));
    try {
      const result = await cleanupUploads(abandoned);
      const removed = new Set(result.deletedDocumentIds);
      const failed = abandoned.filter(image => !removed.has(image.documentId));
      setTracked(scopeKey, [...committed, ...failed]);
      if (result.failures.length) toastApi.error('Some unused pasted images could not be cleaned up.');
    } catch (error) {
      console.error(`[${componentLabel}] Failed reconciling saved draft images`, error);
      toastApi.error('Some unused pasted images could not be cleaned up.');
      setTracked(scopeKey, [...committed, ...abandoned]);
    }
    // The referenced rows were promoted atomically by comment save; they are no longer drafts.
    setTracked(scopeKey, getTracked(scopeKey).filter(image => !committed.includes(image)));
    clipboardUploadSequenceRef.current = 0;
  }, [cleanupUploads, componentLabel, scopeKey, toastApi]);

  // A parent can dismiss the editor or change tasks without going through its cancel button.
  // Wait for in-flight uploads to register, then remove only this scope's still-owned drafts.
  useEffect(() => {
    const cleanupScope = scope;
    cancellingScopesRef.current.delete(scopeKey);
    return () => {
      cancellingScopesRef.current.add(scopeKey);
      void Promise.allSettled([...pendingFor(scopeKey)]).then(async () => {
        const uploads = [...getTracked(scopeKey)];
        if (!uploads.length) {
          if (scopeKeyRef.current !== scopeKey) cancellingScopesRef.current.delete(scopeKey);
          return;
        }
        try {
          const result = await cleanupUploadsRef.current(uploads, cleanupScope);
          if (result.failures.length) console.error(`[${componentLabel}] Failed cleaning drafts after editor dismissal`, result.failures);
        } catch (error) {
          console.error(`[${componentLabel}] Failed cleaning drafts after editor dismissal`, error);
        } finally {
          const dismissedIds = new Set(uploads.map(image => image.documentId));
          const currentScope = scopeRef.current;
          if (currentScope?.entityType !== cleanupScope?.entityType || currentScope?.entityId !== cleanupScope?.entityId) {
            setTracked(scopeKey, getTracked(scopeKey).filter(image => !dismissedIds.has(image.documentId)));
            cancellingScopesRef.current.delete(scopeKey);
          } else {
            trackedByScopeRef.current.delete(scopeKey);
          }
        }
      });
    };
  // The callback ref avoids treating an inline server-action adapter as a scope change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.entityId, scope?.entityType]);

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
      cancellingScopesRef.current.add(scopeKey);
      setIsDeletingDraftImages(true);
      await Promise.allSettled([...pendingFor(scopeKey)]);
    } else if (pendingUploads > 0) return;
    const tracked = getTracked(scopeKey);
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
      cancellingScopesRef.current.delete(scopeKey);
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
    scopeKey,
    toastApi,
  ]);

  return {
    draftClipboardImages,
    isUploading: pendingUploads > 0,
    isDeletingDraftImages,
    keepDraftClipboardImages,
    requestDiscard: commentAttachments ? deleteTrackedDraftClipboardImages : requestDiscard,
    resetDraftTracking,
    reconcileDraftUploads,
    showDraftCancelDialog,
    setShowDraftCancelDialog,
    // Typed as always-present for existing callers, who only hand it to an
    // editor prop; restricted comment editors receive undefined so the editor
    // offers no attachment UI at all.
    uploadFile: (uploadsRestricted ? undefined : uploadFile) as typeof uploadFile,
    deleteTrackedDraftClipboardImages,
  };
}
