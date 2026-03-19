'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  renameClipboardImageForUpload,
  validateClipboardImageFile,
} from '../lib/clipboardImageUtils';

export interface QuickAddDraftClipboardImage {
  file: File;
  name: string;
  url: string;
}

interface UseQuickAddRichTextUploadSessionOptions {
  componentLabel: string;
  onDiscard: () => void;
  toastApi?: Pick<typeof toast, 'error'>;
}

function revokeObjectUrls(images: QuickAddDraftClipboardImage[]) {
  for (const image of images) {
    try {
      URL.revokeObjectURL(image.url);
    } catch (error) {
      console.warn('[useQuickAddRichTextUploadSession] Failed revoking object URL', {
        url: image.url,
        error,
      });
    }
  }
}

export function useQuickAddRichTextUploadSession({
  componentLabel,
  onDiscard,
  toastApi = toast,
}: UseQuickAddRichTextUploadSessionOptions) {
  const [stagedClipboardImages, setStagedClipboardImages] = useState<QuickAddDraftClipboardImage[]>(
    []
  );
  const [showDraftCancelDialog, setShowDraftCancelDialog] = useState(false);
  const [isDeletingDraftImages, setIsDeletingDraftImages] = useState(false);
  const clipboardUploadSequenceRef = useRef(0);
  const latestImagesRef = useRef<QuickAddDraftClipboardImage[]>([]);

  useEffect(() => {
    latestImagesRef.current = stagedClipboardImages;
  }, [stagedClipboardImages]);

  useEffect(() => {
    return () => {
      revokeObjectUrls(latestImagesRef.current);
    };
  }, []);

  const resetDraftTracking = useCallback(() => {
    setStagedClipboardImages((previous) => {
      revokeObjectUrls(previous);
      return [];
    });
    clipboardUploadSequenceRef.current = 0;
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      const validation = validateClipboardImageFile(file);
      if (!validation.valid) {
        const reason = validation.error || 'Clipboard image upload failed.';
        console.warn(`[${componentLabel}] Clipboard upload rejected by validation`, {
          mimeType: file.type,
          sizeBytes: file.size,
          reason,
        });
        toastApi.error(reason);
        throw new Error(reason);
      }

      const sequence = (clipboardUploadSequenceRef.current += 1);
      const timestamp = new Date();
      const renamedFile = renameClipboardImageForUpload({
        file,
        timestamp,
        sequence,
      });
      const localUrl = URL.createObjectURL(renamedFile);

      setStagedClipboardImages((previous) => [
        ...previous,
        {
          file: renamedFile,
          name: renamedFile.name,
          url: localUrl,
        },
      ]);

      return localUrl;
    },
    [componentLabel, toastApi]
  );

  const requestDiscard = useCallback(() => {
    if (stagedClipboardImages.length > 0) {
      setShowDraftCancelDialog(true);
      return;
    }

    resetDraftTracking();
    onDiscard();
  }, [onDiscard, resetDraftTracking, stagedClipboardImages.length]);

  const deleteTrackedDraftClipboardImages = useCallback(async () => {
    setIsDeletingDraftImages(true);
    try {
      console.info(`[${componentLabel}] Quick add discard action: delete staged clipboard images`, {
        imageCount: stagedClipboardImages.length,
      });
      setShowDraftCancelDialog(false);
      resetDraftTracking();
      onDiscard();
    } finally {
      setIsDeletingDraftImages(false);
    }
  }, [componentLabel, onDiscard, resetDraftTracking, stagedClipboardImages.length]);

  return {
    deleteTrackedDraftClipboardImages,
    isDeletingDraftImages,
    requestDiscard,
    resetDraftTracking,
    showDraftCancelDialog,
    stagedClipboardImages,
    setShowDraftCancelDialog,
    uploadFile,
  };
}
