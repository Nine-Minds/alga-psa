'use client';

import React, { useCallback, useMemo, type ReactNode } from 'react';
import {
  DocumentsCrossFeatureProvider,
  type DocumentsCrossFeatureCallbacks,
} from '@alga-psa/core/context/DocumentsCrossFeatureContext';
import {
  createDocumentAssociations,
  deleteDocument,
  getDocumentByTicketId,
  getDocumentCountsForEntities,
  getDocumentsByContractId,
  getDocumentsByEntity,
  getImageUrl,
  removeDocumentAssociations,
  updateDocument,
  uploadDocument,
} from '@alga-psa/documents/actions/documentActions';
import { getBlockContent, updateBlockContent } from '@alga-psa/documents/actions/documentBlockContentActions';
import { downloadDocumentInBrowser } from '@alga-psa/documents/actions/document-download';
import DocumentSelector from '@alga-psa/documents/components/DocumentSelector';
import Documents from '@alga-psa/documents/components/Documents';
import DocumentUpload from '@alga-psa/documents/components/DocumentUpload';
import FolderSelectorModal from '@alga-psa/documents/components/FolderSelectorModal';
import { downloadDocument, getDocumentDownloadUrl } from '@alga-psa/documents/lib/documentUtils';

export function MspDocumentsCrossFeatureProvider({ children }: { children: ReactNode }) {
  const renderDocuments = useCallback(
    (props: Record<string, unknown>) => <Documents {...(props as any)} />,
    []
  );

  const renderDocumentUpload = useCallback(
    (props: Record<string, unknown>) => <DocumentUpload {...(props as any)} />,
    []
  );

  const renderDocumentSelector = useCallback(
    (props: Record<string, unknown>) => <DocumentSelector {...(props as any)} />,
    []
  );

  const renderFolderSelectorModal = useCallback(
    (props: Record<string, unknown>) => <FolderSelectorModal {...(props as any)} />,
    []
  );

  const value = useMemo<DocumentsCrossFeatureCallbacks>(
    () => ({
      renderDocuments,
      renderDocumentUpload,
      renderDocumentSelector,
      renderFolderSelectorModal,
      downloadDocument: async (documentUrl: string, fileName?: string, useFileSystemAPI?: boolean) =>
        downloadDocument(documentUrl, fileName || 'document', useFileSystemAPI),
      getDocumentDownloadUrl: async (documentId: string) => getDocumentDownloadUrl(documentId),
      getDocumentsByEntity,
      getDocumentCountsForEntities,
      getDocumentsByContractId,
      getDocumentByTicketId,
      getImageUrl,
      createDocumentAssociations,
      removeDocumentAssociations,
      deleteDocument,
      updateDocument,
      getBlockContent,
      updateBlockContent,
      downloadDocumentInBrowser,
      uploadDocument,
    }),
    [renderDocuments, renderDocumentSelector, renderDocumentUpload, renderFolderSelectorModal]
  );

  return <DocumentsCrossFeatureProvider value={value}>{children}</DocumentsCrossFeatureProvider>;
}
