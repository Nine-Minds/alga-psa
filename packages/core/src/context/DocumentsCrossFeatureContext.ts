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
  downloadDocument: (documentId: string, fileName?: string) => Promise<unknown>;
  getDocumentDownloadUrl: (documentId: string, fileName?: string) => Promise<string>;
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
