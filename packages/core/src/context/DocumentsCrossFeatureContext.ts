import { createContext, createElement, useContext, type ReactNode } from 'react';

export interface DocumentsRenderProps {
  [key: string]: unknown;
}

export interface DocumentUploadRenderProps {
  [key: string]: unknown;
}

export interface DocumentSelectorRenderProps {
  [key: string]: unknown;
}

export interface FolderSelectorModalRenderProps {
  [key: string]: unknown;
}

export interface DocumentsCrossFeatureCallbacks {
  renderDocuments: (props: DocumentsRenderProps) => ReactNode;
  renderDocumentUpload: (props: DocumentUploadRenderProps) => ReactNode;
  renderDocumentSelector: (props: DocumentSelectorRenderProps) => ReactNode;
  renderFolderSelectorModal: (props: FolderSelectorModalRenderProps) => ReactNode;
  downloadDocument: (
    documentUrl: string,
    fileName?: string,
    useFileSystemAPI?: boolean
  ) => Promise<unknown>;
  getDocumentDownloadUrl: (documentId: string, fileName?: string) => Promise<string>;
  getDocumentsByEntity: (entityId: string, entityType: any) => Promise<any>;
  getDocumentCountsForEntities: (entityIds: string[], entityType: any) => Promise<any>;
  getDocumentsByContractId: (contractId: string) => Promise<any>;
  getDocumentByTicketId: (ticketId: string) => Promise<any>;
  getImageUrl: (fileId: string) => Promise<any>;
  createDocumentAssociations: (
    entityId: string,
    entityType: any,
    documentIds: string[]
  ) => Promise<any>;
  removeDocumentAssociations: (
    entityId: string,
    entityType: any,
    documentIds?: string[]
  ) => Promise<any>;
  deleteDocument: (documentId: string, userId: string) => Promise<any>;
  updateDocument: (documentId: string, data: any) => Promise<any>;
  getBlockContent: (documentId: string) => Promise<any>;
  updateBlockContent: (documentId: string, input: any) => Promise<any>;
  downloadDocumentInBrowser: (documentId: string, documentName: string) => Promise<any>;
  uploadDocument: (formData: FormData, metadata: any) => Promise<any>;
}

const DocumentsCrossFeatureContext = createContext<DocumentsCrossFeatureCallbacks | null>(null);

export function useDocumentsCrossFeature(): DocumentsCrossFeatureCallbacks {
  const ctx = useContext(DocumentsCrossFeatureContext);
  if (!ctx) {
    throw new Error(
      'useDocumentsCrossFeature must be used within a DocumentsCrossFeatureProvider. ' +
      'Wrap your page in a provider from a composition layer.'
    );
  }
  return ctx;
}

export function DocumentsCrossFeatureProvider({
  value,
  children,
}: {
  value: DocumentsCrossFeatureCallbacks;
  children: ReactNode;
}) {
  return createElement(DocumentsCrossFeatureContext.Provider, { value }, children);
}
