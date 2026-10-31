'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import type { IDocument } from '@alga-psa/types';
import { useDocumentsCrossFeature } from '@alga-psa/core/context/DocumentsCrossFeatureContext';

/**
 * Opens a document a stage declaration cites, in the same viewer drawer
 * OpportunityDocumentsTile uses. Resolves it from the deal's own document
 * list, so a document no longer attached to the deal simply doesn't open.
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
  const { getDocumentsByEntity, renderDocuments } = useDocumentsCrossFeature();
  const [documents, setDocuments] = useState<IDocument[]>([]);

  useEffect(() => {
    let active = true;
    getDocumentsByEntity(opportunityId, 'opportunity')
      .then((result) => {
        if (active) setDocuments(Array.isArray(result?.documents) ? result.documents : []);
      })
      .catch(() => {
        if (active) onClose();
      });
    return () => {
      active = false;
    };
    // onClose is a fresh closure each render; only the target matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getDocumentsByEntity, opportunityId, documentId]);

  const document = documents.find((candidate) => candidate.document_id === documentId);
  if (!document) return null;
  return renderDocuments({
    id: 'opportunity-citation-document-drawer',
    documents,
    userId: session?.user?.id || '',
    entityId: opportunityId,
    entityType: 'opportunity',
    documentToOpen: document,
    drawerOnly: true,
    onDocumentClosed: onClose,
  });
}
