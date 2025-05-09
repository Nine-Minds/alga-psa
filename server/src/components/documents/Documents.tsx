'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { IDocument, DocumentFilters } from 'server/src/interfaces/document.interface';
import DocumentStorageCard from './DocumentStorageCard';
import DocumentUpload from './DocumentUpload';
import DocumentSelector from './DocumentSelector';
import DocumentsPagination from './DocumentsPagination';
import { DocumentsGridSkeleton } from './DocumentsPageSkeleton';
import { Button } from 'server/src/components/ui/Button';
import Drawer from 'server/src/components/ui/Drawer';
import { Input } from 'server/src/components/ui/Input';
import TextEditor from 'server/src/components/editor/TextEditor';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import { Plus, Link, FileText, Edit3, Download } from 'lucide-react';
import { useAutomationIdAndRegister } from 'server/src/types/ui-reflection/useAutomationIdAndRegister';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { ContainerComponent, FormFieldComponent, ButtonComponent } from 'server/src/types/ui-reflection/types';
import { 
  getDocumentsByEntity,
  deleteDocument,
  removeDocumentAssociations,
  updateDocument,
  uploadDocument
} from 'server/src/lib/actions/document-actions/documentActions';
import {
  getBlockContent,
  updateBlockContent,
  createBlockDocument
} from 'server/src/lib/actions/document-actions/documentBlockContentActions';

const DEFAULT_BLOCKS: PartialBlock[] = [{
  type: "paragraph",
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  },
  content: [{
    type: "text",
    text: "",
    styles: {}
  }]
}];

interface DocumentsProps {
  id?: string;
  documents: IDocument[];
  gridColumns?: 3 | 4;
  userId: string;
  searchTermFromParent?: string;
  entityId?: string;
  entityType?: 'ticket' | 'company' | 'contact' | 'schedule' | 'asset';
  isLoading?: boolean;
  onDocumentCreated?: () => Promise<void>;
  isInDrawer?: boolean;
  uploadFormRef?: React.RefObject<HTMLDivElement>;
}

const Documents = ({
  id = 'documents',
  documents: initialDocuments,
  gridColumns,
  userId,
  entityId,
  entityType,
  isLoading = false,
  onDocumentCreated,
  isInDrawer = false,
  uploadFormRef,
  searchTermFromParent = ''
}: DocumentsProps): JSX.Element => {
  const [documentsToDisplay, setDocumentsToDisplay] = useState<IDocument[]>(initialDocuments);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [showUpload, setShowUpload] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<IDocument | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newDocumentName, setNewDocumentName] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCKS);
  const [hasContentChanged, setHasContentChanged] = useState(false);
  const editorRef = useRef<BlockNoteEditor | null>(null);
  const [isEditModeInDrawer, setIsEditModeInDrawer] = useState(false);

  useEffect(() => {
    if (initialDocuments && initialDocuments.length > 0) {
        setDocumentsToDisplay(initialDocuments);
    }
  }, [initialDocuments]);


  const fetchDocuments = useCallback(async (page: number, searchTerm?: string) => {
    if (!entityId || !entityType) {
      if (searchTerm) {
        const filtered = initialDocuments.filter(doc =>
          doc.document_name.toLowerCase().includes(searchTerm.toLowerCase())
        );
        setDocumentsToDisplay(filtered);
        setTotalPages(1);
        setCurrentPage(1);
      } else {
        setDocumentsToDisplay(initialDocuments);
        setTotalPages(1);
        setCurrentPage(1);
      }
      return;
    }

    try {
      const currentFilters: DocumentFilters = {
        searchTerm: searchTerm || undefined,
      };
      const response = await getDocumentsByEntity(entityId, entityType, currentFilters, page, pageSize);
      setDocumentsToDisplay(response.documents);
      setTotalDocuments(response.totalCount);
      setTotalPages(response.totalPages);
      setCurrentPage(response.currentPage);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError('Failed to fetch documents.');
      setDocumentsToDisplay([]);
      setTotalPages(1);
      setCurrentPage(1);
    }
  }, [entityId, entityType, pageSize, initialDocuments]);


  useEffect(() => {
    fetchDocuments(currentPage, searchTermFromParent);
  }, [fetchDocuments, currentPage, searchTermFromParent]);


  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handleCreateDocument = async () => {
    setIsCreatingNew(true);
    setNewDocumentName('');
    setCurrentContent(DEFAULT_BLOCKS);
    setSelectedDocument(null);
    setIsLoadingContent(false);
    setIsEditModeInDrawer(true);
    setIsDrawerOpen(true);
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasContentChanged(true);
  };

  const handleDelete = async (document: IDocument) => {
    try {
      await deleteDocument(document.document_id, userId);
      setDocumentsToDisplay(prev => prev.filter(d => d.document_id !== document.document_id));
      if (onDocumentCreated) {
        await onDocumentCreated();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      setError('Failed to delete document');
    }
  };

  const handleDisassociate = async (document: IDocument) => {
    if (!entityId || !entityType) return;

    try {
      await removeDocumentAssociations(entityId, entityType, [document.document_id]);
      setDocumentsToDisplay(prev => prev.filter(d => d.document_id !== document.document_id));
      if (onDocumentCreated) {
        await onDocumentCreated();
      }
    } catch (error) {
      console.error('Error disassociating document:', error);
      setError('Failed to remove document association');
    }
  };

  const handleSaveNewDocument = async () => {
    try {
      if (!newDocumentName.trim()) {
        setError('Document name is required');
        return;
      }

      setIsSaving(true);
      const result = await createBlockDocument({
        document_name: newDocumentName,
        user_id: userId,
        block_data: JSON.stringify(currentContent),
        entityId,
        entityType
      });

      // Refresh documents list
      if (entityId && entityType) {
        fetchDocuments(currentPage, searchTermFromParent);
      }

      if (onDocumentCreated) {
        await onDocumentCreated();
      }

      setIsCreatingNew(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error('Error creating document:', error);
      setError('Failed to create document');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveChanges = async () => {
    try {
      if (!selectedDocument) return;

      setIsSaving(true);

      // Update document name
      await updateDocument(selectedDocument.document_id, {
        document_name: documentName,
        edited_by: userId
      });

      // Update content if changed
      if (hasContentChanged) {
        await updateBlockContent(selectedDocument.document_id, {
          block_data: JSON.stringify(currentContent),
          user_id: userId
        });
      }

      // Refresh documents list
      if (entityId && entityType) {
        fetchDocuments(currentPage, searchTermFromParent);
      }

      if (onDocumentCreated) {
        await onDocumentCreated();
      }

      setHasContentChanged(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error('Error saving document:', error);
      setError('Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  // Load document content when selected
  useEffect(() => {
    const loadContent = async () => {
      if (selectedDocument?.document_id) {
        setIsLoadingContent(true);
        try {
          const content = await getBlockContent(selectedDocument.document_id);
          if (content?.block_data) {
            try {
              const parsedContent = typeof content.block_data === 'string'
                ? JSON.parse(content.block_data)
                : content.block_data;
              setCurrentContent(parsedContent);
            } catch (error) {
              console.error('Error parsing content:', error);
              setCurrentContent(DEFAULT_BLOCKS);
            }
          } else {
            setCurrentContent(DEFAULT_BLOCKS);
          }
        } catch (error) {
          console.error('Error loading document content:', error);
          setError('Failed to load document content');
          setCurrentContent(DEFAULT_BLOCKS);
        } finally {
          setIsLoadingContent(false);
        }
      }
    };

    if (selectedDocument) {
      loadContent();
    }
  }, [selectedDocument]);


  const gridColumnsClass = gridColumns === 4
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <ReflectionContainer id={id} label="Documents">
      <div className="w-full space-y-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex space-x-2">
            <Button
              id={`${id}-new-document-btn`}
              onClick={handleCreateDocument}
              className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Document
            </Button>
            <Button
              id={`${id}-upload-btn`}
              onClick={() => {
                setShowUpload(true);
                // Add a small delay to ensure the element is rendered before scrolling
                setTimeout(() => {
                  uploadFormRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }, 0);
              }}
              className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Upload File
            </Button>
            {entityId && entityType && (
              <Button
                id={`${id}-link-documents-btn`}
                onClick={() => setShowSelector(true)}
                className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                data-testid="link-documents-button"
              >
                <Link className="w-4 h-4 mr-2" />
                Link Documents
              </Button>
            )}
          </div>
        </div>

        {showUpload && (
          <div ref={uploadFormRef} className="mb-4 p-4 border border-gray-200 rounded-md bg-white">
            <DocumentUpload
              id={`${id}-upload`}
              userId={userId}
              entityId={entityId}
              entityType={entityType}
              onUploadComplete={async () => {
                setShowUpload(false);
                if (onDocumentCreated) await onDocumentCreated();
              }}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        )}

        {showSelector && entityId && entityType ? (
          <DocumentSelector
            id={`${id}-selector`}
            entityId={entityId}
            entityType={entityType}
            onDocumentsSelected={async () => {
              // Refresh documents list after association
              if (entityId && entityType) {
                try {
                } catch (error) {
                  console.error('Error associating documents:', error);
                  setError('Failed to associate documents');
                }
              }
              setShowSelector(false);
              if (onDocumentCreated) await onDocumentCreated();
            }}
            isOpen={showSelector}
            onClose={() => setShowSelector(false)}
          />
        ) : null}

        {error && (
          <div className="text-center py-4 text-red-500 bg-red-50 rounded-md">
            {error}
          </div>
        )}

        {isLoading ? (
          <DocumentsGridSkeleton gridColumns={gridColumns} />
        ) : documentsToDisplay.length > 0 ? (
          <div className={`grid ${gridColumnsClass} gap-4`}>
            {documentsToDisplay.map((document) => (
              <div key={document.document_id} className="h-full">
                <DocumentStorageCard
                  id={`${id}-document-${document.document_id}`}
                  document={document}
                  onDelete={() => handleDelete(document)}
                  onDisassociate={entityId && entityType ? () => handleDisassociate(document) : undefined}
                  showDisassociate={Boolean(entityId && entityType)}
                  onClick={() => {
                    setSelectedDocument(document);
                    setDocumentName(document.document_name);
                    setIsCreatingNew(false);
                    const isEditableContentDoc = (!document.file_id && (document.type_name === 'text/plain' || document.type_name === 'text/markdown' || !document.type_name));
                    setIsEditModeInDrawer(isEditableContentDoc);
                    setIsDrawerOpen(true);
                  }}
                  isContentDocument={!document.file_id}
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
            No documents found
          </div>
        )}

        {documentsToDisplay.length > 0 && totalPages > 1 && (
          <div className="mt-4">
            <DocumentsPagination
              id={`${id}-pagination`}
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={handlePageChange}
            />
          </div>
        )}

        <div className="document-drawer">
          <Drawer
            id={`${id}-document-drawer`}
            isOpen={isDrawerOpen}
            onClose={() => setIsDrawerOpen(false)}
            isInDrawer={isInDrawer}
            hideCloseButton={true}
            drawerVariant="document"
          >
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 pb-4">
              <h2 className="text-lg font-semibold">
                {isCreatingNew ? 'New Document' : (isEditModeInDrawer ? 'Edit Document' : 'View Document')}
              </h2>
              <div className="flex items-center space-x-2">
                {selectedDocument &&
                  (selectedDocument.type_name === 'text/plain' ||
                   selectedDocument.type_name === 'text/markdown' ||
                   (!selectedDocument.type_name && !selectedDocument.file_id)
                  ) && (
                  <Button
                    id={`${id}-download-pdf-btn`}
                    onClick={() => {
                      if (selectedDocument) {
                        window.open(`/api/documents/download/${selectedDocument.document_id}?format=pdf`, '_blank');
                      }
                    }}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                )}
                {!isCreatingNew && !isEditModeInDrawer && selectedDocument && (
                  <Button
                    id={`${id}-edit-document-btn`}
                    onClick={() => setIsEditModeInDrawer(true)}
                    variant="outline"
                    size="sm"
                  >
                    <Edit3 className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                )}
                {!isInDrawer && (
                  <Button
                    id={`${id}-close-drawer-btn`}
                    onClick={() => {
                      setIsDrawerOpen(false);
                      if (!isCreatingNew) {
                        setIsEditModeInDrawer(false);
                      }
                    }}
                    variant="ghost"
                  >
                    ×
                  </Button>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="mb-4 relative p-0.5">
                <Input
                  id={`${id}-document-name`}
                  type="text"
                  placeholder="Document Name"
                  value={isCreatingNew ? newDocumentName : documentName}
                  onChange={(e) => {
                    if (isCreatingNew || isEditModeInDrawer) {
                      if (isCreatingNew) {
                        setNewDocumentName(e.target.value);
                      } else {
                        setDocumentName(e.target.value);
                      }
                    }
                  }}
                  readOnly={!isCreatingNew && !isEditModeInDrawer}
                  className={(!isCreatingNew && !isEditModeInDrawer) ? "bg-gray-100 cursor-default" : ""}
                />
              </div>

              <div className="flex-1 overflow-y-auto mb-4 p-2">
                <div className="h-full w-full">
                  {isLoadingContent ? (
                    <div className="flex justify-center items-center h-full">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#6941C6]"></div>
                    </div>
                  ) : isCreatingNew || (selectedDocument && isEditModeInDrawer) ? (
                    <TextEditor
                      key={isCreatingNew ? "editor-new" : `editor-${selectedDocument?.document_id}`}
                      id={`${id}-editor`}
                      initialContent={currentContent}
                      onContentChange={handleContentChange}
                      editorRef={editorRef}
                    />
                  ) : selectedDocument ? (
                    <RichTextViewer
                      id={`${id}-viewer`}
                      content={currentContent}
                    />
                  ) : (
                    <div className="flex justify-center items-center h-full text-gray-500">
                      Select a document or create a new one.
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end space-x-2">
                <Button
                  id={`${id}-cancel-btn`}
                  onClick={() => {
                    setIsDrawerOpen(false);
                    if (!isCreatingNew) {
                      setIsEditModeInDrawer(false);
                    }
                  }}
                  variant="outline"
                >
                  Cancel
                </Button>
                {(isCreatingNew || isEditModeInDrawer) && (
                  <Button
                    id={`${id}-save-btn`}
                    onClick={isCreatingNew ? handleSaveNewDocument : handleSaveChanges}
                    disabled={isSaving || (!hasContentChanged && !isCreatingNew && documentName === selectedDocument?.document_name)}
                    className="bg-[#6941C6] text-white hover:bg-[#5B34B5]"
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                )}
              </div>
            </div>
          </div>
          </Drawer>
        </div>
      </div>
    </ReflectionContainer>
  );
};

export default Documents;
