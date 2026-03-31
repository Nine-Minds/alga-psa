/* eslint-disable custom-rules/no-feature-to-feature-imports -- Uses document selector and actions for image picking */
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { DocumentSelector } from '@alga-psa/documents/components';
import { getDocumentByFileId, toggleDocumentVisibility } from '@alga-psa/documents/actions';
import { AlertTriangle, Eye, ImageIcon } from 'lucide-react';
import type { IDocument } from '@alga-psa/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a file_id from a `/api/documents/view/{fileId}` URL. */
const FILE_ID_RE = /\/api\/documents\/view\/([a-f0-9-]+)/i;

function parseFileIdFromUrl(src: string): string | null {
  const match = FILE_ID_RE.exec(src);
  return match ? match[1] : null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Props = {
  /** Current image source URL (may be any URL or a /api/documents/view/… path). */
  currentSrc: string;
  /** Called when the user picks a document image. `commit` = true for blur/select. */
  onSourceChange: (url: string, commit: boolean) => void;
};

type VisibilityInfo = {
  documentId: string;
  documentName: string;
  isClientVisible: boolean;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function DocumentImagePickerWidget({ currentSrc, onSourceChange }: Props) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [visibility, setVisibility] = useState<VisibilityInfo | null>(null);
  const [isTogglingVisibility, setIsTogglingVisibility] = useState(false);

  // ---- Check visibility whenever the src changes and points to our doc system ----
  useEffect(() => {
    let cancelled = false;

    const fileId = parseFileIdFromUrl(currentSrc);
    if (!fileId) {
      setVisibility(null);
      return;
    }

    (async () => {
      try {
        const info = await getDocumentByFileId(fileId);
        if (cancelled) return;
        if (info) {
          setVisibility({
            documentId: info.document_id,
            documentName: info.document_name,
            isClientVisible: info.is_client_visible,
          });
        } else {
          setVisibility(null);
        }
      } catch {
        if (!cancelled) setVisibility(null);
      }
    })();

    return () => { cancelled = true; };
  }, [currentSrc]);

  // ---- Handlers ----
  const handleDocumentSelected = useCallback(async (doc: IDocument) => {
    if (!doc.file_id) return;
    const url = `/api/documents/view/${doc.file_id}`;
    onSourceChange(url, true);
    setIsPickerOpen(false);

    // Immediately reflect visibility for the newly-selected doc
    setVisibility({
      documentId: doc.document_id,
      documentName: doc.document_name,
      isClientVisible: !!doc.is_client_visible,
    });
  }, [onSourceChange]);

  const handleMakeVisible = useCallback(async () => {
    if (!visibility) return;
    setIsTogglingVisibility(true);
    try {
      await toggleDocumentVisibility([visibility.documentId], true);
      setVisibility((prev) => prev ? { ...prev, isClientVisible: true } : null);
    } catch {
      // Silently fail — the user can retry
    } finally {
      setIsTogglingVisibility(false);
    }
  }, [visibility]);

  // ---- Render ----
  return (
    <div className="space-y-2">
      {/* Browse button */}
      <Button
        id="designer-media-browse-documents"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => setIsPickerOpen(true)}
      >
        <ImageIcon className="mr-1.5 h-3.5 w-3.5" />
        Browse Documents
      </Button>

      {/* Visibility warning */}
      {visibility && !visibility.isClientVisible && (
        <div className="rounded-md border border-amber-300 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 space-y-1.5">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-semibold">{visibility.documentName}</span> is hidden from clients.
              It will not appear on quotes or invoices viewed through the client portal.
            </p>
          </div>
          <Button
            id="designer-media-make-visible"
            variant="outline"
            size="sm"
            className="w-full"
            disabled={isTogglingVisibility}
            onClick={handleMakeVisible}
          >
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            {isTogglingVisibility ? 'Updating...' : 'Mark as visible to clients'}
          </Button>
        </div>
      )}

      {/* Visibility confirmed */}
      {visibility && visibility.isClientVisible && (
        <p className="flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
          <Eye className="h-3.5 w-3.5" />
          Visible in client portal
        </p>
      )}

      {/* Document selector dialog */}
      <DocumentSelector
        id="designer-image-document-selector"
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        singleSelect
        typeFilter="image"
        title="Select Image"
        description="Choose an image from your documents to use in this template."
        onDocumentSelected={handleDocumentSelected}
      />
    </div>
  );
}
