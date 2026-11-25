'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { IDocument } from '@alga-psa/types';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';

/**
 * Opens a document a stage declaration cites, in the same viewer drawer
 * OpportunityDocumentsTile uses. Fetches the one cited document through the
 * authorised single-document action, so it opens however many documents the
 * deal has. A document that is gone, or that the caller may not read, closes
 * without rendering.
 */
export function OpportunityCitationDocument({
  opportunityId,
  documentId,
  onClose,
}: {
  opportunityId: string;
  documentId: string;
  onClose: () => void;
}) {
  const { data: session } = useSession();
  const { getDocument, renderDocuments } = useDocumentsCrossFeature();
  const [document, setDocument] = useState<IDocument | null>(null);

  useEffect(() => {
    let active = true;
    setDocument(null);
    getDocument(documentId)
      .then((result) => {
        if (!active) return;
        // The action answers a missing document with null and a denied read with { permissionError }.
        if (result && typeof result === 'object' && 'document_id' in result) setDocument(result as IDocument);
        else onClose();
      })
      .catch(() => {
        if (active) onClose();
      });
    return () => {
      active = false;
    };
    // onClose is a fresh closure each render; only the target matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDocument, documentId]);

  if (!document) return null;
  return renderDocuments({
    id: 'opportunity-citation-document-drawer',
    documents: [document],
    userId: session?.user?.id || '',
    entityId: opportunityId,
    entityType: 'opportunity',
    documentToOpen: document,
    drawerOnly: true,
    onDocumentClosed: onClose,
  });
}
