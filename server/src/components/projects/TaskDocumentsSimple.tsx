'use client'

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Plus, Link, FileText, File, Image, Download, X, ChevronRight, ChevronDown } from 'lucide-react';
import { IDocument } from 'server/src/interfaces/document.interface';
import { 
  getDocumentsByEntity,
  removeDocumentAssociations
} from 'server/src/lib/actions/document-actions/documentActions';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Button } from 'server/src/components/ui/Button';
import DocumentUpload from 'server/src/components/documents/DocumentUpload';
import DocumentSelector from 'server/src/components/documents/DocumentSelector';
import Drawer from 'server/src/components/ui/Drawer';
import { Input } from 'server/src/components/ui/Input';
import TextEditor from 'server/src/components/editor/TextEditor';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import {
  getBlockContent,
  updateBlockContent,
  createBlockDocument
} from 'server/src/lib/actions/document-actions/documentBlockContentActions';
import { updateDocument } from 'server/src/lib/actions/document-actions/documentActions';
import { downloadDocumentInBrowser } from 'server/src/lib/actions/document-download/downloadHelpers';
import { downloadDocument } from 'server/src/lib/utils/documentUtils';
import { toast } from 'react-hot-toast';
import { ConfirmationDialog } from 'server/src/components/ui/ConfirmationDialog';
import FolderSelectorModal from 'server/src/components/documents/FolderSelectorModal';

const DEFAULT_BLOCKS: PartialBlock[] = [{
  type: "paragraph",
  props: {
    textAlignment: "left",
    backgroundColor: "default",
    textColor: "default"
  },
  content: [{
    type: "text",
    text: '',
    styles: {}
  }]
}];

interface TaskDocumentsSimpleProps {
  taskId: string;
  initialDocuments?: IDocument[];
  onDocumentCreated?: () => Promise<void>;
}

export default function TaskDocumentsSimple({
  taskId,
  initialDocuments,
  onDocumentCreated
}: TaskDocumentsSimpleProps) {
  const router = useRouter();
  const [documents, setDocuments] = useState<IDocument[]>(initialDocuments || []);
  const [loading, setLoading] = useState(false);
  const [documentsLoaded, setDocumentsLoaded] = useState(!!initialDocuments);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  
  // Drawer states for viewing/editing documents
  const [selectedDocument, setSelectedDocument] = useState<IDocument | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [documentName, setDocumentName] = useState('');
  const [currentContent, setCurrentContent] = useState<PartialBlock[]>(DEFAULT_BLOCKS);
  const [hasContentChanged, setHasContentChanged] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const editorRef = useRef<BlockNoteEditor | null>(null);
  
  // New document states
  const [newDocumentName, setNewDocumentName] = useState('');
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  // Folder selection for new documents
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [selectedFolderPath, setSelectedFolderPath] = useState<string | null>(null);

  // Delete confirmation
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [documentToDelete, setDocumentToDelete] = useState<IDocument | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClosing, setIsClosing] = useState(false);

  const fetchUser = async () => {
    if (currentUser) return currentUser;

    try {
      const user = await getCurrentUser();
      setCurrentUser(user);
      return user;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  };

  // Sync from props when initialDocuments changes
  useEffect(() => {
    if (initialDocuments !== undefined) {
      setDocuments(initialDocuments);
      setDocumentsLoaded(true);
    }
  }, [initialDocuments]);

  // Handle document mutation - use callback or router.refresh()
  const handleDocumentMutation = useCallback(async () => {
    if (onDocumentCreated) {
      await onDocumentCreated();
    } else {
      router.refresh();
    }
  }, [onDocumentCreated, router]);

  const fetchDocuments = async () => {
    if (documentsLoaded) return; // Don't refetch if already loaded

    try {
      setLoading(true);
      const response = await getDocumentsByEntity(taskId, 'project_task');
      setDocuments(response.documents);
      setDocumentsLoaded(true);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  // Load documents when expanded - only if no initialDocuments provided
  useEffect(() => {
    if (isExpanded && taskId && !documentsLoaded && !initialDocuments) {
      fetchDocuments();
    }
  }, [isExpanded, taskId, documentsLoaded, initialDocuments]);

  const getFileIcon = (document: IDocument) => {
    if (!document.file_id) return <FileText className="h-4 w-4 text-blue-600" />;
    if (!document.mime_type) return <File className="h-4 w-4" />;
    if (document.mime_type.includes('pdf')) return <FileText className="h-4 w-4 text-red-600" />;
    if (document.mime_type.includes('image')) return <Image className="h-4 w-4 text-blue-600" />;
    return <File className="h-4 w-4" />;
  };

  const handleDocumentClick = async (document: IDocument) => {
    // For uploaded files, download directly
    if (document.file_id) {
      await handleDownload({ stopPropagation: () => {} } as React.MouseEvent, document);
      return;
    }
    
    // For in-app documents, open in drawer for editing
    setSelectedDocument(document);
    setDocumentName(document.document_name);
    setIsCreatingNew(false);
    setIsEditMode(true); // Always open in edit mode
    setIsDrawerOpen(true);
    
    // Load content for block document
    setIsLoadingContent(true);
    try {
      const content = await getBlockContent(document.document_id);
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
      toast.error('Failed to load document content');
      setCurrentContent(DEFAULT_BLOCKS);
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleCreateNew = async () => {
    // Fetch user if not already loaded
    const user = await fetchUser();
    if (!user) {
      toast.error('Please log in to create documents');
      return;
    }

    // Load documents if not already loaded
    if (!documentsLoaded) {
      await fetchDocuments();
    }

    // Show folder selector first
    setShowFolderModal(true);
  };

  const handleFolderSelected = async (folderPath: string | null) => {
    setSelectedFolderPath(folderPath);
    setShowFolderModal(false);

    // Now open the drawer to create the document
    setIsCreatingNew(true);
    setNewDocumentName('');
    setCurrentContent(DEFAULT_BLOCKS);
    setSelectedDocument(null);
    setIsEditMode(true);
    setIsDrawerOpen(true);
  };

  const handleSaveNewDocument = async () => {
    if (!newDocumentName.trim()) {
      toast.error('Document name is required');
      return;
    }
    
    // Fetch user if not already loaded
    const user = await fetchUser();
    if (!user) {
      toast.error('Please log in to save documents');
      return;
    }

    try {
      setIsSaving(true);
      await createBlockDocument({
        document_name: newDocumentName,
        user_id: user.user_id,
        block_data: JSON.stringify(currentContent),
        entityId: taskId,
        entityType: 'project_task',
        folder_path: selectedFolderPath
      });

      toast.success('Document created successfully');
      await handleDocumentMutation();
      handleCloseDrawer();
      setIsCreatingNew(false);
      setSelectedFolderPath(null); // Reset folder selection
    } catch (error) {
      console.error('Error creating document:', error);
      toast.error('Failed to create document');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveChanges = async () => {
    if (!selectedDocument) return;
    
    // Fetch user if not already loaded
    const user = await fetchUser();
    if (!user) {
      toast.error('Please log in to save documents');
      return;
    }

    try {
      setIsSaving(true);

      // Update document name
      await updateDocument(selectedDocument.document_id, {
        document_name: documentName,
        edited_by: user.user_id
      });

      // Update content if changed
      if (hasContentChanged) {
        await updateBlockContent(selectedDocument.document_id, {
          block_data: JSON.stringify(currentContent),
          user_id: user.user_id
        });
      }

      toast.success('Document updated successfully');
      await handleDocumentMutation();
      setHasContentChanged(false);
      setIsEditMode(false);
    } catch (error) {
      console.error('Error saving document:', error);
      toast.error('Failed to save document');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (e: React.MouseEvent, document: IDocument) => {
    e.stopPropagation();
    setDocumentToDelete(document);
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = async () => {
    if (!documentToDelete) return;

    try {
      await removeDocumentAssociations(taskId, 'project_task', [documentToDelete.document_id]);
      toast.success('Document removed successfully');
      await handleDocumentMutation();
    } catch (error) {
      console.error('Error removing document:', error);
      toast.error('Failed to remove document');
    } finally {
      setShowDeleteConfirm(false);
      setDocumentToDelete(null);
    }
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasContentChanged(true);
  };

  const handleCloseDrawer = () => {
    // Mark as closing to hide the editor
    setIsClosing(true);
    
    // Clear editor ref first to prevent cleanup issues
    if (editorRef.current) {
      editorRef.current = null;
    }
    
    // Small delay to allow editor cleanup
    setTimeout(() => {
      setIsDrawerOpen(false);
      setIsEditMode(false);
      setIsCreatingNew(false);
      setSelectedDocument(null);
      setCurrentContent(DEFAULT_BLOCKS);
      setHasContentChanged(false);
      setDocumentName('');
      setNewDocumentName('');
      setIsClosing(false);
    }, 100);
  };

  const handleDownload = async (e: React.MouseEvent, document: IDocument) => {
    e.stopPropagation();
    try {
      // For in-app documents, download as PDF
      if (!document.file_id) {
        const downloadUrl = `/api/documents/download/${document.document_id}?format=pdf`;
        const filename = `${document.document_name || 'document'}.pdf`;
        await downloadDocument(downloadUrl, filename, true);
      } else {
        // For uploaded files, use the enhanced download with file picker
        const downloadUrl = `/api/documents/download/${document.document_id}`;
        const filename = document.document_name || 'download';
        await downloadDocument(downloadUrl, filename, true);
      }
    } catch (error) {
      console.error('Error downloading document:', error);
      toast.error('Failed to download document');
    }
  };

  const handlePDFExport = async (document: IDocument) => {
    try {
      const downloadUrl = `/api/documents/download/${document.document_id}?format=pdf`;
      const filename = `${document.document_name || 'document'}.pdf`;
      await downloadDocument(downloadUrl, filename, true);
    } catch (error) {
      console.error('Error exporting PDF:', error);
      toast.error('Failed to export PDF');
    }
  };

  return (
    <>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <button 
            className="flex items-center gap-2 hover:text-gray-700 transition-colors"
            onClick={() => setIsExpanded(!isExpanded)}
            type="button"
          >
            {isExpanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <Paperclip className="h-4 w-4" />
            <h3 className="font-medium">Attachments</h3>
            {documentsLoaded && documents.length > 0 && (
              <span className="text-sm text-gray-500">({documents.length})</span>
            )}
          </button>
          <div className="flex gap-2">
            <Button
              id="task-documents-create-new-btn"
              type="button"
              size="sm"
              variant="ghost"
              onClick={handleCreateNew}
              title="Create new document"
            >
              <FileText className="h-4 w-4 mr-1" />
              <span className="text-xs">New</span>
            </Button>
            <Button
              id="task-documents-upload-btn"
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                // Fetch user if not already loaded
                const user = await fetchUser();
                if (!user) {
                  toast.error('Please log in to upload documents');
                  return;
                }
                
                if (!documentsLoaded) {
                  await fetchDocuments();
                }
                setShowUpload(!showUpload);
              }}
              title="Upload file"
            >
              <Plus className="h-4 w-4 mr-1" />
              <span className="text-xs">Upload</span>
            </Button>
            <Button
              id="task-documents-link-btn"
              type="button"
              size="sm"
              variant="ghost"
              onClick={async () => {
                if (!documentsLoaded) {
                  await fetchDocuments();
                }
                setShowSelector(true);
              }}
              title="Link existing document"
            >
              <Link className="h-4 w-4 mr-1" />
              <span className="text-xs">Link</span>
            </Button>
          </div>
        </div>

        {/* Action sections and document list - only show when expanded */}
        {isExpanded && (
          <>
            {showUpload && currentUser && (
          <div className="p-3 border border-gray-200 rounded-md bg-gray-50">
            <DocumentUpload
              id="task-document-upload"
              userId={currentUser.user_id}
              entityId={taskId}
              entityType="project_task"
              onUploadComplete={async (result) => {
                setShowUpload(false);
                if (result?.success) {
                  toast.success('Document uploaded successfully');
                  await handleDocumentMutation();
                }
              }}
              onCancel={() => setShowUpload(false)}
            />
          </div>
        )}

        {/* Document list */}
        {loading ? (
          <div className="flex justify-center py-4">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-900"></div>
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-4 text-gray-500 text-sm">
            No documents attached
          </div>
        ) : (
          <div className="space-y-1">
            {documents.map((doc) => (
              <div
                key={doc.document_id}
                className="flex items-center justify-between p-2 hover:bg-gray-50 rounded cursor-pointer group"
                onClick={() => handleDocumentClick(doc)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {getFileIcon(doc)}
                  <span className="text-sm truncate">{doc.document_name}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    id={`task-document-download-${doc.document_id}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handleDownload(e, doc)}
                    title="Download"
                  >
                    <Download className="h-3 w-3" />
                  </Button>
                  <Button
                    id={`task-document-remove-${doc.document_id}`}
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={(e) => handleDeleteClick(e, doc)}
                    className="text-red-600 hover:text-red-700"
                    title="Remove"
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
          </>
        )}
      </div>

      {/* Document selector modal */}
      {showSelector && (
        <DocumentSelector
          id="task-document-selector"
          entityId={taskId}
          entityType="project_task"
          onDocumentsSelected={async () => {
            setShowSelector(false);
            await handleDocumentMutation();
          }}
          isOpen={showSelector}
          onClose={() => setShowSelector(false)}
        />
      )}

      {/* Document viewer/editor drawer */}
      <Drawer
        id="task-document-drawer"
        isOpen={isDrawerOpen}
        onClose={handleCloseDrawer}
        isInDrawer={true}
        hideCloseButton={true}
        drawerVariant="document"
      >
        <div className="flex flex-col h-full">
          <div className="flex justify-between items-center mb-4 pb-4 border-b">
            <h2 className="text-lg font-semibold">
              {isCreatingNew ? 'New Document' : (isEditMode ? 'Edit Document' : 'View Document')}
            </h2>
            <div className="flex items-center gap-2">
              {selectedDocument && !selectedDocument.file_id && (
                <>
                  <Button
                    id="task-document-pdf-btn"
                    onClick={() => handlePDFExport(selectedDocument)}
                    variant="outline"
                    size="sm"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    PDF
                  </Button>
                  {!isEditMode && (
                    <Button
                      id="task-document-edit-btn"
                      onClick={() => setIsEditMode(true)}
                      variant="outline"
                      size="sm"
                    >
                      Edit
                    </Button>
                  )}
                </>
              )}
              <Button
                id="task-document-drawer-close-btn"
                onClick={handleCloseDrawer}
                variant="ghost"
                size="sm"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Document name */}
          <div className="mb-4">
            <Input
              id="task-document-name-input"
              type="text"
              placeholder="Document Name"
              value={isCreatingNew ? newDocumentName : documentName}
              onChange={(e) => {
                if (isCreatingNew) {
                  setNewDocumentName(e.target.value);
                } else if (isEditMode) {
                  setDocumentName(e.target.value);
                }
              }}
              readOnly={!isCreatingNew && !isEditMode}
              className={(!isCreatingNew && !isEditMode) ? "bg-gray-100" : ""}
            />
          </div>

          {/* Content area */}
          <div className="flex-1 overflow-y-auto mb-4">
            {selectedDocument?.file_id ? (
              // File document - show download link
              <div className="flex flex-col items-center justify-center h-full text-gray-500">
                <div className="mb-4">{getFileIcon(selectedDocument)}</div>
                <p className="mb-4">This is a file attachment</p>
                <Button
                  id="task-document-download-file-btn"
                  onClick={async () => {
                    try {
                      const result = await downloadDocumentInBrowser(selectedDocument.document_id, selectedDocument.document_name);
                      if (!result.success) {
                        throw new Error(result.error || 'Download failed');
                      }
                    } catch (error) {
                      console.error('Error downloading document:', error);
                      toast.error('Failed to download document');
                    }
                  }}
                  variant="default"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download File
                </Button>
              </div>
            ) : isLoadingContent ? (
              <div className="flex justify-center items-center h-full">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
              </div>
            ) : (isCreatingNew || isEditMode) && !isClosing ? (
              <TextEditor
                key={selectedDocument?.document_id || 'new'}
                id="task-document-editor"
                initialContent={currentContent}
                onContentChange={handleContentChange}
                editorRef={editorRef}
              />
            ) : !isClosing ? (
              <RichTextViewer
                id="task-document-viewer"
                content={currentContent}
              />
            ) : null}
          </div>

          {/* Actions */}
          {(isCreatingNew || isEditMode) && (
            <div className="flex justify-end gap-2 pt-4 border-t">
              <Button
                id="task-document-cancel-btn"
                onClick={() => {
                  if (isCreatingNew) {
                    handleCloseDrawer();
                    setIsCreatingNew(false);
                  } else {
                    setIsEditMode(false);
                    setHasContentChanged(false);
                    // Reload original content
                    handleDocumentClick(selectedDocument!);
                  }
                }}
                variant="outline"
              >
                Cancel
              </Button>
              <Button
                id="task-document-save-btn"
                onClick={isCreatingNew ? handleSaveNewDocument : handleSaveChanges}
                disabled={isSaving || (isCreatingNew && !newDocumentName.trim())}
                variant="default"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          )}
        </div>
      </Drawer>

      {/* Folder Selector Modal */}
      <FolderSelectorModal
        isOpen={showFolderModal}
        onClose={() => setShowFolderModal(false)}
        onSelectFolder={handleFolderSelected}
        title="Select Folder for New Document"
        description="Choose where to save this new document"
      />

      {/* Delete confirmation dialog */}
      <ConfirmationDialog
        isOpen={showDeleteConfirm}
        onClose={() => {
          setShowDeleteConfirm(false);
          setDocumentToDelete(null);
        }}
        onConfirm={handleDeleteConfirm}
        title="Remove Document from Task"
        message={`Are you sure you want to remove "${documentToDelete?.document_name}" from this task? The document will still be available in the Documents section and can be linked to other items.`}
        confirmLabel="Remove from Task"
        cancelLabel="Cancel"
      />
    </>
  );
}