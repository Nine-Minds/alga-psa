'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import { IDocument, DocumentFilters } from 'server/src/interfaces/document.interface';
import DocumentStorageCard from './DocumentStorageCard';
import DocumentUpload from './DocumentUpload';
import Spinner from 'server/src/components/ui/Spinner';
import DocumentSelector from './DocumentSelector';
import DocumentsPagination from './DocumentsPagination';
import { DocumentsGridSkeleton } from './DocumentsPageSkeleton';
import { Button } from 'server/src/components/ui/Button';
import Drawer from 'server/src/components/ui/Drawer';
import { Input } from 'server/src/components/ui/Input';
import TextEditor from 'server/src/components/editor/TextEditor';
import RichTextViewer from 'server/src/components/editor/RichTextViewer';
import FolderTreeView from './FolderTreeView';
import FolderManager from './FolderManager';
import DocumentListView from './DocumentListView';
import ViewSwitcher from 'server/src/components/ui/ViewSwitcher';
import FolderSelectorModal from './FolderSelectorModal';
import { Plus, Link, FileText, Edit3, Download, Grid, List as ListIcon, FolderPlus, ChevronRight, X, FolderInput, Trash2 } from 'lucide-react';
import { useTranslation } from 'server/src/lib/i18n/client';
import { downloadDocument, getDocumentDownloadUrl } from 'server/src/lib/utils/documentUtils';
import toast from 'react-hot-toast';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';
import { useUserPreference } from 'server/src/hooks/useUserPreference';
import {
  getDocumentsByEntity,
  getDocumentsByFolder,
  moveDocumentsToFolder,
  createFolder,
  deleteDocument,
  removeDocumentAssociations,
  updateDocument
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

const DOCUMENT_VIEW_MODE_SETTING = 'documents_view_mode';
const DOCUMENT_GRID_PAGE_SIZE_SETTING = 'documents_grid_page_size';
const DOCUMENT_LIST_PAGE_SIZE_SETTING = 'documents_list_page_size';

interface DocumentsProps {
  id?: string;
  documents: IDocument[];
  gridColumns?: 3 | 4;
  userId: string;
  searchTermFromParent?: string;
  entityId?: string;
  entityType?: 'ticket' | 'client' | 'contact' | 'asset' | 'project_task' | 'contract';
  isLoading?: boolean;
  onDocumentCreated?: () => Promise<void>;
  isInDrawer?: boolean;
  uploadFormRef?: React.RefObject<HTMLDivElement>;
  filters?: DocumentFilters;
  namespace?: 'common' | 'clientPortal';
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
  searchTermFromParent = '',
  filters,
  namespace = 'common'
}: DocumentsProps): JSX.Element => {
  const { t } = useTranslation('common');
  const router = useRouter();
  const searchParams = useSearchParams();
  const [documentsToDisplay, setDocumentsToDisplay] = useState<IDocument[]>(initialDocuments);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalDocuments, setTotalDocuments] = useState(0);

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
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [editedDocumentId, setEditedDocumentId] = useState<string | null>(null);
  const [refreshTimestamp, setRefreshTimestamp] = useState<number>(0);


  // Determine if we're in folder mode (no entity specified) early
  // This affects whether we need user preferences
  const inFolderMode = !entityId && !entityType;

  // User preferences are only needed in folder mode (main Documents page)
  // In entity mode (contract/ticket documents), we use simple defaults
  const {
    value: folderViewMode,
    setValue: setFolderViewMode
  } = useUserPreference<'grid' | 'list'>(
    DOCUMENT_VIEW_MODE_SETTING,
    {
      defaultValue: 'grid',
      localStorageKey: DOCUMENT_VIEW_MODE_SETTING,
      debounceMs: 300,
      userId,
      skipServerFetch: !inFolderMode // Only fetch from server in folder mode
    }
  );

  const {
    value: folderGridPageSize,
    setValue: setFolderGridPageSize
  } = useUserPreference<number>(
    DOCUMENT_GRID_PAGE_SIZE_SETTING,
    {
      defaultValue: 9,
      localStorageKey: DOCUMENT_GRID_PAGE_SIZE_SETTING,
      debounceMs: 300,
      userId,
      skipServerFetch: !inFolderMode
    }
  );

  const {
    value: folderListPageSize,
    setValue: setFolderListPageSize
  } = useUserPreference<number>(
    DOCUMENT_LIST_PAGE_SIZE_SETTING,
    {
      defaultValue: 10,
      localStorageKey: DOCUMENT_LIST_PAGE_SIZE_SETTING,
      debounceMs: 300,
      userId,
      skipServerFetch: !inFolderMode
    }
  );

  // In folder mode, use preferences; in entity mode, use defaults
  const viewMode = inFolderMode ? folderViewMode : 'grid';
  const setViewMode = setFolderViewMode;
  const gridPageSize = inFolderMode ? folderGridPageSize : 9;
  const setGridPageSize = setFolderGridPageSize;
  const listPageSize = inFolderMode ? folderListPageSize : 10;
  const setListPageSize = setFolderListPageSize;

  // Current page size based on view mode
  const pageSize = viewMode === 'grid' ? gridPageSize : listPageSize;

  const [currentFolder, setCurrentFolder] = useState<string | null>(() => {
    // Initialize from URL on mount (only in folder mode)
    if (!entityId && !entityType) {
      const folderParam = searchParams.get('folder');
      return folderParam || null;
    }
    return null;
  });
  const [selectedDocumentsForMove, setSelectedDocumentsForMove] = useState<Set<string>>(new Set());

  // Sync currentFolder with URL changes (for breadcrumb navigation)
  useEffect(() => {
    if (!entityId && !entityType) {
      const folderParam = searchParams.get('folder');
      setCurrentFolder(folderParam || null);
    }
  }, [searchParams, entityId, entityType]);

  // Reset to first page when view mode changes
  useEffect(() => {
    setCurrentPage(1);
  }, [viewMode]);
  const [showFolderManager, setShowFolderManager] = useState(false);
  const [folderTreeKey, setFolderTreeKey] = useState(0); // For forcing tree refresh
  const [isFoldersPaneCollapsed, setIsFoldersPaneCollapsed] = useState(false);
  const [isFiltersPaneCollapsed, setIsFiltersPaneCollapsed] = useState(false);

  // Folder selector for new in-app documents
  const [showDocumentFolderModal, setShowDocumentFolderModal] = useState(false);
  const [documentFolderPath, setDocumentFolderPath] = useState<string | null>(null);

  // Move document modal
  const [showMoveFolderModal, setShowMoveFolderModal] = useState(false);
  const [showBulkMoveFolderModal, setShowBulkMoveFolderModal] = useState(false);
  const [documentToMove, setDocumentToMove] = useState<IDocument | null>(null);

  // Preview modal for images/videos/PDFs
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewDocument, setPreviewDocument] = useState<IDocument | null>(null);

  // Sync documents from props when they change (e.g., after router.refresh() in entity mode)
  useEffect(() => {
    // In entity mode, always sync from initialDocuments when they change
    if (!inFolderMode) {
      setDocumentsToDisplay(initialDocuments);
      setTotalDocuments(initialDocuments.length);
    }
  }, [initialDocuments, inFolderMode]);

  // Single effect to fetch documents
  // In entity mode: uses initialDocuments passed from parent (no client-side fetch)
  // In folder mode: fetches from server
  useEffect(() => {
    let cancelled = false;

    const fetchDocuments = async () => {
      // Folder mode: fetch by folder
      if (inFolderMode) {
        try {
          const includeSubfolders = filters?.showAllDocuments || false;
          const folderToFetch = filters?.showAllDocuments ? null : currentFolder;

          const response = await getDocumentsByFolder(folderToFetch, includeSubfolders, currentPage, pageSize, filters);

          if (!cancelled) {
            setDocumentsToDisplay(response.documents);
            setTotalDocuments(response.total);
            setTotalPages(Math.ceil(response.total / pageSize));
          }
        } catch (err) {
          if (!cancelled) {
            console.error('Error fetching documents by folder:', err);
            setError(t('documents.messages.fetchFailed', 'Failed to fetch documents.'));
            setDocumentsToDisplay([]);
            setTotalPages(1);
          }
        }
        return;
      }

      // Entity mode: use initialDocuments from parent (no client-side fetching)
      // Parent component (e.g., ContractDetail) should fetch and pass documents
      if (!cancelled) {
        if (searchTermFromParent) {
          const filtered = initialDocuments.filter(doc =>
            doc.document_name.toLowerCase().includes(searchTermFromParent.toLowerCase())
          );
          setDocumentsToDisplay(filtered);
        } else {
          setDocumentsToDisplay(initialDocuments);
        }
        setTotalDocuments(initialDocuments.length);
        setTotalPages(1);
      }
    };

    fetchDocuments();

    return () => {
      cancelled = true;
    };
  }, [currentPage, pageSize, searchTermFromParent, inFolderMode, currentFolder, filters, initialDocuments, t]);

  // Refresh documents - handles both folder mode and entity mode
  const refreshDocuments = useCallback(async () => {
    if (inFolderMode) {
      // Folder mode: refetch from server
      try {
        const includeSubfolders = filters?.showAllDocuments || false;
        const folderToFetch = filters?.showAllDocuments ? null : currentFolder;
        const response = await getDocumentsByFolder(folderToFetch, includeSubfolders, currentPage, pageSize, filters);
        setDocumentsToDisplay(response.documents);
        setTotalDocuments(response.total);
        setTotalPages(Math.ceil(response.total / pageSize));
      } catch (err) {
        console.error('Error refreshing documents:', err);
        setError(t('documents.messages.fetchFailed', 'Failed to fetch documents.'));
      }
    } else {
      // Entity mode: trigger parent to refresh via router.refresh()
      if (onDocumentCreated) {
        onDocumentCreated();
      }
    }
  }, [inFolderMode, filters, currentFolder, currentPage, pageSize, onDocumentCreated, t]);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newPageSize: number) => {
    // Save to the appropriate preference based on current view mode
    if (viewMode === 'grid') {
      setGridPageSize(newPageSize);
    } else {
      setListPageSize(newPageSize);
    }
    setCurrentPage(1); // Reset to first page when page size changes
  };

  // Page size options for grid view (list view uses DataTable defaults)
  const gridPageSizeOptions = useMemo(
    () => [
      { value: '9', label: t('documents.pagination.perPage', { count: 9, defaultValue: '9 per page' }) },
      { value: '18', label: t('documents.pagination.perPage', { count: 18, defaultValue: '18 per page' }) },
      { value: '27', label: t('documents.pagination.perPage', { count: 27, defaultValue: '27 per page' }) },
      { value: '36', label: t('documents.pagination.perPage', { count: 36, defaultValue: '36 per page' }) }
    ],
    [t]
  );

  // Folder-specific handlers
  const handleFolderSelect = (folderPath: string | null) => {
    setCurrentFolder(folderPath);
    setCurrentPage(1); // Reset to first page when changing folders

    // Update URL to persist folder selection
    if (inFolderMode) {
      const params = new URLSearchParams(searchParams.toString());
      if (folderPath) {
        params.set('folder', folderPath);
      } else {
        params.delete('folder');
      }
      const newUrl = params.toString() ? `?${params.toString()}` : window.location.pathname;
      router.replace(newUrl);
    }
  };

  const handleFolderCreated = async (folderPath: string) => {
    try {
      // Create the folder in the database
      await createFolder(folderPath);

      // Show success toast
      toast.success(
        t('documents.messages.folderCreated', {
          name: folderPath,
          defaultValue: `Folder "${folderPath}" created successfully`
        })
      );

      // Navigate to the new folder
      setCurrentFolder(folderPath);
      setShowFolderManager(false);

      // Refresh the folder tree to show the new folder immediately
      setFolderTreeKey(prev => prev + 1);
    } catch (error) {
      console.error('Failed to create folder:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : t('documents.messages.folderCreateFailed', 'Failed to create folder');
      toast.error(errorMessage);
      setError(errorMessage);
    }
  };

  const handleMoveDocuments = async (targetFolder: string | null) => {
    if (selectedDocumentsForMove.size === 0) return;

    try {
      await moveDocumentsToFolder(
        Array.from(selectedDocumentsForMove),
        targetFolder
      );

      const count = selectedDocumentsForMove.size;
      const folderName =
        targetFolder || t('documents.folders.root', 'Root');
      toast.success(
        t('documents.messages.moveDocumentsSuccess', {
          count,
          destination: folderName,
          defaultValue: `${count} document${count !== 1 ? 's' : ''} moved to ${folderName}`
        })
      );

      setSelectedDocumentsForMove(new Set());
      setShowBulkMoveFolderModal(false);
      await refreshDocuments();

      // Refresh folder tree to update counts
      setFolderTreeKey(prev => prev + 1);
    } catch (error) {
      console.error('Failed to move documents:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : t('documents.messages.moveDocumentsFailed', 'Failed to move documents');
      toast.error(errorMessage);
      setError(errorMessage);
    }
  };

  const handleCreateDocument = async () => {
    // In folder mode: auto-save to current folder if browsing one
    if (inFolderMode && currentFolder) {
      setDocumentFolderPath(currentFolder);
      // Open drawer directly without folder selector
      setIsCreatingNew(true);
      setNewDocumentName('');
      setCurrentContent(DEFAULT_BLOCKS);
      setSelectedDocument(null);
      setIsLoadingContent(false);
      setIsEditModeInDrawer(true);
      setIsDrawerOpen(true);
    } else {
      // Entity mode or root folder: show folder selector
      setShowDocumentFolderModal(true);
    }
  };

  const handleDocumentFolderSelected = (folderPath: string | null) => {
    setDocumentFolderPath(folderPath);
    setShowDocumentFolderModal(false);
    // Now open the drawer to create the document
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

  const handleDelete = useCallback(async (document: IDocument) => {
    // Note: Confirmation dialog is handled by DocumentStorageCard component
    try {
      await deleteDocument(document.document_id, userId);
      setDocumentsToDisplay(prev => prev.filter(d => d.document_id !== document.document_id));
      toast.success(
        t('documents.messages.deleteSuccess', {
          name: document.document_name,
          defaultValue: `Document "${document.document_name}" deleted successfully`
        })
      );
      if (onDocumentCreated) {
        await onDocumentCreated();
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : t('documents.messages.deleteFailed', 'Failed to delete document');
      toast.error(errorMessage);
      setError(errorMessage);
    }
  }, [userId, onDocumentCreated]);

  const handleDisassociate = useCallback(async (document: IDocument) => {
    if (!entityId || !entityType) return;

    try {
      await removeDocumentAssociations(entityId, entityType, [document.document_id]);
      setDocumentsToDisplay(prev => prev.filter(d => d.document_id !== document.document_id));
      if (onDocumentCreated) {
        await onDocumentCreated();
      }
    } catch (error) {
      console.error('Error disassociating document:', error);
      setError(
        t('documents.messages.removeAssociationFailed', 'Failed to remove document association')
      );
    }
  }, [entityId, entityType, onDocumentCreated]);

  const handleMoveDocument = useCallback((document: IDocument) => {
    setDocumentToMove(document);
    setShowMoveFolderModal(true);
  }, []);

  const handleMoveFolderSelected = async (folderPath: string | null) => {
    if (!documentToMove) return;

    try {
      await moveDocumentsToFolder([documentToMove.document_id], folderPath);

      toast.success(
        t('documents.messages.moveDocumentSuccess', {
          name: documentToMove.document_name,
          defaultValue: `Document "${documentToMove.document_name}" moved successfully`
        })
      );

      // Refresh the document list
      await refreshDocuments();

      // Refresh folder tree to update counts
      if (inFolderMode) {
        setFolderTreeKey(prev => prev + 1);
      }

      // Reset state
      setDocumentToMove(null);
      setShowMoveFolderModal(false);
    } catch (error) {
      console.error('Failed to move document:', error);
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : t('documents.messages.moveDocumentFailed', 'Failed to move document');
      toast.error(errorMessage);
      setError(errorMessage);
    }
  };

  const handleSaveNewDocument = async () => {
    try {
      if (!newDocumentName.trim()) {
        setDrawerError(
          t('documents.validation.nameRequired', 'Document name is required')
        );
        return;
      }

      setIsSaving(true);
      setDrawerError(null);
      const result = await createBlockDocument({
        document_name: newDocumentName,
        user_id: userId,
        block_data: JSON.stringify(currentContent),
        entityId,
        entityType,
        folder_path: documentFolderPath
      });

      // Refresh the document list (triggers router.refresh() in entity mode)
      await refreshDocuments();

      // Reset folder selection for next document
      setDocumentFolderPath(null);

      setIsCreatingNew(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error('Error creating document:', error);
      setDrawerError(
        t('documents.messages.createFailed', 'Failed to create document')
      );
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

      // Trigger preview refresh for only the edited document
      setEditedDocumentId(selectedDocument.document_id);
      setRefreshTimestamp(Date.now());

      // Don't call onDocumentCreated (which refetches all documents)
      // We only need to refresh the preview, not reload all documents

      setHasContentChanged(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error('Error saving document:', error);
      setDrawerError(
        t('documents.messages.saveFailed', 'Failed to save document')
      );
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
          setError(
            t('documents.messages.loadContentFailed', 'Failed to load document content')
          );
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

  // Use refs to store click handlers to avoid recreating them
  const clickHandlersRef = useRef<Map<string, () => void>>(new Map());
  const moveHandlersRef = useRef<Map<string, () => void>>(new Map());

  const handleDocumentClick = async (document: IDocument) => {
    // For in-app documents (no file_id), open in drawer/editor
    if (!document.file_id) {
      setSelectedDocument(document);
      setDocumentName(document.document_name);
      setIsCreatingNew(false);
      const isEditableContentDoc = (document.type_name === 'text/plain' || document.type_name === 'text/markdown' || !document.type_name);
      setIsEditModeInDrawer(isEditableContentDoc);
      setIsDrawerOpen(true);
      return;
    }

    // For images, videos, and PDFs - show in preview modal
    if (document.mime_type?.startsWith('image/') ||
        document.mime_type?.startsWith('video/') ||
        document.mime_type === 'application/pdf') {
      setPreviewDocument(document);
      setShowPreviewModal(true);
      return;
    }

    // For other files, trigger download
    const downloadUrl = getDocumentDownloadUrl(document.file_id);
    const filename = document.document_name || 'download';
    try {
      await downloadDocument(downloadUrl, filename, true);
    } catch (error) {
      console.error('Download failed:', error);
      toast.error(
        t('documents.messages.downloadFailed', 'Failed to download document')
      );
    }
  };

  const getOrCreateClickHandler = (document: IDocument) => {
    const key = document.document_id;
    if (!clickHandlersRef.current.has(key)) {
      clickHandlersRef.current.set(key, () => handleDocumentClick(document));
    }
    return clickHandlersRef.current.get(key)!;
  };

  // Similarly for delete and disassociate handlers
  const deleteHandlersRef = useRef<Map<string, () => void>>(new Map());
  const disassociateHandlersRef = useRef<Map<string, () => void>>(new Map());

  const getOrCreateDeleteHandler = (document: IDocument) => {
    const key = document.document_id;
    if (!deleteHandlersRef.current.has(key)) {
      deleteHandlersRef.current.set(key, () => handleDelete(document));
    }
    return deleteHandlersRef.current.get(key)!;
  };

  const getOrCreateDisassociateHandler = (document: IDocument) => {
    if (!entityId || !entityType) return undefined;
    const key = document.document_id;
    if (!disassociateHandlersRef.current.has(key)) {
      disassociateHandlersRef.current.set(key, () => handleDisassociate(document));
    }
    return disassociateHandlersRef.current.get(key)!;
  };

  const getOrCreateMoveHandler = (document: IDocument) => {
    const key = document.document_id;
    if (!moveHandlersRef.current.has(key)) {
      moveHandlersRef.current.set(key, () => handleMoveDocument(document));
    }
    return moveHandlersRef.current.get(key)!;
  };

  // Render document cards - let React handle the re-renders with memo
  const renderDocumentCards = () => {
    return documentsToDisplay.map((document) => {
      const isEditableContentDoc = (!document.file_id && (document.type_name === 'text/plain' || document.type_name === 'text/markdown' || !document.type_name));

      return (
        <div key={document.document_id} className="h-full">
          <DocumentStorageCard
            id={`${id}-document-${document.document_id}`}
            document={document}
            onDelete={getOrCreateDeleteHandler(document)}
            onDisassociate={getOrCreateDisassociateHandler(document)}
            onMove={getOrCreateMoveHandler(document)}
            showDisassociate={Boolean(entityId && entityType)}
            showMove={inFolderMode}
            forceRefresh={editedDocumentId === document.document_id ? refreshTimestamp : undefined}
            onClick={getOrCreateClickHandler(document)}
            isContentDocument={!document.file_id}
          />
        </div>
      );
    });
  };

  // Folder mode: show folder tree sidebar and new layout
  if (inFolderMode) {
    return (
      <ReflectionContainer id={id} label="Documents">
        <div className="flex flex-col h-[calc(100vh-200px)]">
          {/* Header with Actions */}
          <div className="border-b border-gray-200 p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">

              {/* New Document Button */}
              <Button
                id={`${id}-new-document-btn`}
                variant="default"
                onClick={handleCreateDocument}
              >
                <FileText className="w-4 h-4 mr-2" />
                New Document
              </Button>

              {/* Upload Button */}
              <Button
                id={`${id}-upload-btn`}
                variant="default"
                onClick={() => setShowUpload(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Upload
              </Button>

              {/* Create Folder Button */}
              <Button
                id={`${id}-new-folder-btn`}
                variant="outline"
                onClick={() => setShowFolderManager(true)}
              >
                <FolderPlus className="w-4 h-4 mr-2" />
                New Folder
              </Button>
            </div>

            {/* View Mode Switcher */}
            <ViewSwitcher
              currentView={viewMode}
              onChange={setViewMode}
              options={[
                { value: 'grid', label: 'Grid', icon: Grid },
                { value: 'list', label: 'List', icon: ListIcon },
              ]}
            />
          </div>

          {/* Content with sidebars */}
          <div className="flex flex-1 overflow-hidden">
            {/* Collapsed Folders Button */}
            {isFoldersPaneCollapsed && (
              <div className="flex-shrink-0 border-r border-gray-200 flex items-start p-2">
                <button
                  onClick={() => setIsFoldersPaneCollapsed(false)}
                  className="p-1 hover:bg-gray-100 rounded"
                  title="Show folders"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Folder Navigation Sidebar */}
            {!isFoldersPaneCollapsed && (
              <div className="w-64 flex-shrink-0 border-r border-gray-200">
                <FolderTreeView
                  key={folderTreeKey}
                  selectedFolder={currentFolder}
                  onFolderSelect={handleFolderSelect}
                  onFolderDeleted={() => {
                    refreshDocuments();
                  }}
                  isCollapsed={isFoldersPaneCollapsed}
                  onToggleCollapse={() => setIsFoldersPaneCollapsed(!isFoldersPaneCollapsed)}
                />
              </div>
            )}

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col overflow-hidden">

            {showUpload && (
              <div ref={uploadFormRef} className="m-4 p-4 border border-gray-200 rounded-md bg-white">
                <DocumentUpload
                  id={`${id}-upload`}
                  userId={userId}
                  entityId={entityId}
                  entityType={entityType}
                  folderPath={currentFolder}
                  onUploadComplete={async () => {
                    setShowUpload(false);
                    await refreshDocuments();
                  }}
                  onCancel={() => setShowUpload(false)}
                />
              </div>
            )}

            {/* Document Display */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <DocumentsGridSkeleton gridColumns={3} />
              ) : error ? (
                <div className="text-center py-4 text-red-500 bg-red-50 rounded-md">
                  {error}
                </div>
              ) : (
                <>
                  {/* Bulk Actions Toolbar */}
                  {selectedDocumentsForMove.size > 0 && viewMode === 'list' && (
                    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-blue-900">
                          {t('documents.bulkActions.selected', {
                            count: selectedDocumentsForMove.size,
                            defaultValue: `${selectedDocumentsForMove.size} document${selectedDocumentsForMove.size !== 1 ? 's' : ''} selected`
                          })}
                        </span>
                        <div className="flex items-center gap-2">
                          {!entityId && !entityType && (
                            <Button
                              id="bulk-move-button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setShowBulkMoveFolderModal(true)}
                            >
                              <FolderInput className="w-4 h-4 mr-2" />
                              {t('documents.bulkActions.moveToFolder', 'Move to Folder')}
                            </Button>
                          )}
                          <Button
                            id="bulk-delete-button"
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              const count = selectedDocumentsForMove.size;
                              if (
                                !confirm(
                                  t('documents.prompts.confirmBulkDelete', {
                                    count,
                                    defaultValue: `Are you sure you want to delete ${count} document${count !== 1 ? 's' : ''}?`
                                  })
                                )
                              ) {
                                return;
                              }
                              try {
                                const deletePromises = Array.from(selectedDocumentsForMove).map(docId => {
                                  const doc = documentsToDisplay.find(d => d.document_id === docId);
                                  return doc ? deleteDocument(docId, userId) : Promise.resolve();
                                });
                                await Promise.all(deletePromises);
                                toast.success(
                                  t('documents.messages.bulkDeleteSuccess', {
                                    count,
                                    defaultValue: `${count} document${count !== 1 ? 's' : ''} deleted successfully`
                                  })
                                );
                                setSelectedDocumentsForMove(new Set());
                                await refreshDocuments();
                              } catch (error) {
                                console.error('Error deleting documents:', error);
                                toast.error(
                                  t('documents.messages.bulkDeleteFailed', 'Failed to delete some documents')
                                );
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {t('documents.bulkActions.deleteSelected', 'Delete Selected')}
                          </Button>
                        </div>
                      </div>
                      <Button
                        id="bulk-clear-selection-button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedDocumentsForMove(new Set())}
                      >
                        <X className="w-4 h-4 mr-2" />
                        {t('documents.bulkActions.clearSelection', 'Clear Selection')}
                      </Button>
                    </div>
                  )}

                  {viewMode === 'list' ? (
                    <DocumentListView
                      documents={documentsToDisplay}
                      selectedDocuments={selectedDocumentsForMove}
                      onSelectionChange={setSelectedDocumentsForMove}
                      onDelete={(doc) => handleDelete(doc)}
                      onClick={(doc) => handleDocumentClick(doc)}
                    />
                  ) : (
                    documentsToDisplay.length > 0 ? (
                      <div className={`grid ${gridColumnsClass} gap-4`}>
                        {renderDocumentCards()}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
                        {t('documents.empty.folder', 'No documents found in this folder')}
                      </div>
                    )
                  )}
                </>
              )}
            </div>

            {/* Pagination */}
            {documentsToDisplay.length > 0 && totalPages > 1 && (
              <div className="border-t border-gray-200 p-4">
                <DocumentsPagination
                  id={`${id}-pagination`}
                  currentPage={currentPage}
                  totalItems={totalDocuments}
                  itemsPerPage={pageSize}
                  onPageChange={handlePageChange}
                  onItemsPerPageChange={handlePageSizeChange}
                  itemsPerPageOptions={viewMode === 'grid' ? gridPageSizeOptions : undefined}
                />
              </div>
            )}
          </div>

          {/* Folder Manager Dialog */}
          <FolderManager
            open={showFolderManager}
            onClose={() => setShowFolderManager(false)}
            currentFolder={currentFolder}
            onFolderCreated={handleFolderCreated}
          />

          {/* Folder Selector Modal for New Documents */}
          <FolderSelectorModal
            isOpen={showDocumentFolderModal}
            onClose={() => setShowDocumentFolderModal(false)}
            onSelectFolder={handleDocumentFolderSelected}
            title={t('documents.folderSelector.newDocumentTitle', 'Select Folder for New Document')}
            description={t('documents.folderSelector.newDocumentDescription', 'Choose where to save this new document')}
            namespace={namespace}
          />

          {/* Folder Selector Modal for Moving Documents */}
          <FolderSelectorModal
            isOpen={showMoveFolderModal}
            onClose={() => {
              setShowMoveFolderModal(false);
              setDocumentToMove(null);
            }}
            onSelectFolder={handleMoveFolderSelected}
            title={t('documents.folderSelector.moveTitle', 'Move Document')}
            description={
              documentToMove
                ? t('documents.folderSelector.moveDescriptionWithName', {
                    name: documentToMove.document_name,
                    defaultValue: `Select destination folder for "${documentToMove.document_name}"`
                  })
                : t('documents.folderSelector.moveDescription', 'Select destination folder')
            }
            namespace={namespace}
          />

          {/* Folder Selector Modal for Bulk Moving Documents */}
          <FolderSelectorModal
            isOpen={showBulkMoveFolderModal}
            onClose={() => {
              setShowBulkMoveFolderModal(false);
            }}
            onSelectFolder={handleMoveDocuments}
            title={t('documents.folderSelector.bulkMoveTitle', 'Move Selected Documents')}
            description={t('documents.folderSelector.bulkMoveDescription', {
              count: selectedDocumentsForMove.size,
              defaultValue: `Select destination folder for ${selectedDocumentsForMove.size} document${selectedDocumentsForMove.size !== 1 ? 's' : ''}`
            })}
            namespace={namespace}
          />

          {/* Preview Modal for Images/Videos/PDFs */}
          {showPreviewModal && previewDocument && previewDocument.file_id && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75" onClick={() => setShowPreviewModal(false)}>
              <div className="relative max-w-7xl max-h-[90vh] w-full mx-4" onClick={(e) => e.stopPropagation()}>
                <button
                  className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
                  onClick={() => setShowPreviewModal(false)}
                >
                  <X className="w-8 h-8" />
                </button>
                {previewDocument.mime_type?.startsWith('image/') && (
                  <img
                    src={previewDocument.preview_file_id ? `/api/documents/${previewDocument.document_id}/preview` : `/api/documents/view/${previewDocument.file_id}`}
                    alt={previewDocument.document_name}
                    className="max-w-full max-h-[90vh] object-contain mx-auto"
                  />
                )}
                {previewDocument.mime_type?.startsWith('video/') && (
                  <video
                    src={`/api/documents/view/${previewDocument.file_id}`}
                    controls
                    className="max-w-full max-h-[90vh] mx-auto"
                  />
                )}
                {previewDocument.mime_type === 'application/pdf' && (
                  <iframe
                    src={`/api/documents/view/${previewDocument.file_id}`}
                    className="w-full h-[90vh] bg-white"
                    title={previewDocument.document_name}
                  />
                )}
                <div className="mt-2 text-center text-white">
                  <p className="text-lg font-medium">{previewDocument.document_name}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Document Drawer (keep existing drawer functionality) */}
        <div className="document-drawer">
          <Drawer
            id={`${id}-document-drawer`}
            isOpen={isDrawerOpen}
            onClose={() => {
              setIsDrawerOpen(false);
              setDrawerError(null);
            }}
            isInDrawer={isInDrawer}
            hideCloseButton={true}
            drawerVariant="document"
          >
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 pb-4">
              <h2 className="text-lg font-semibold">
                {isCreatingNew ? t('documents.newDocument', 'New Document') : (isEditModeInDrawer ? t('documents.editDocument', 'Edit Document') : t('documents.viewDocument', 'View Document'))}
              </h2>
              <div className="flex items-center space-x-2">
                {selectedDocument &&
                  (selectedDocument.type_name === 'text/plain' ||
                   selectedDocument.type_name === 'text/markdown' ||
                   (!selectedDocument.type_name && !selectedDocument.file_id)
                  ) && (
                  <Button
                    id={`${id}-download-pdf-btn`}
                    onClick={async () => {
                      if (selectedDocument) {
                        const downloadUrl = `/api/documents/download/${selectedDocument.document_id}?format=pdf`;
                        const filename = `${selectedDocument.document_name || 'document'}.pdf`;
                        try {
                          await downloadDocument(downloadUrl, filename, true);
                        } catch (error) {
                          console.error('Download failed:', error);
                        }
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
                      setDrawerError(null);
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
              {drawerError && (
                <div className="mb-4 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded">
                  {drawerError}
                </div>
              )}
              <div className="mb-4 relative p-0.5">
                <Input
                  id={`${id}-document-name`}
                  type="text"
                  placeholder="Document Name *"
                  value={isCreatingNew ? newDocumentName : documentName}
                  onChange={(e) => {
                    if (isCreatingNew || isEditModeInDrawer) {
                      if (isCreatingNew) {
                        setNewDocumentName(e.target.value);
                        setDrawerError(null);
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
                      <Spinner size="sm" />
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
                    setDrawerError(null);
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
                    variant="default"
                    className={isCreatingNew && !newDocumentName.trim() ? 'opacity-50' : ''}
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
  }

  // Entity mode: existing layout
  return (
    <ReflectionContainer id={id} label="Documents">
      <div className="w-full space-y-4">
        <div className="flex justify-between items-center mb-4">
          <div className="flex space-x-2">
            <Button
              id={`${id}-new-document-btn`}
              onClick={handleCreateDocument}
              variant="default"
            >
              <FileText className="w-4 h-4 mr-2" />
              {t('documents.newDocument', 'New Document')}
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
              variant="default"
            >
              <Plus className="w-4 h-4 mr-2" />
              {t('documents.uploadFile', 'Upload File')}
            </Button>
            {entityId && entityType && (
              <Button
                id={`${id}-link-documents-btn`}
                onClick={() => setShowSelector(true)}
                variant="default"
                data-testid="link-documents-button"
              >
                <Link className="w-4 h-4 mr-2" />
                {t('documents.linkDocuments', 'Link Documents')}
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
                // Refresh the documents list (triggers router.refresh() in entity mode)
                await refreshDocuments();
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
              setShowSelector(false);
              // Refresh the documents list (triggers router.refresh() in entity mode)
              await refreshDocuments();
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
            {renderDocumentCards()}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
            {t('documents.empty.default', 'No documents found')}
          </div>
        )}

        {documentsToDisplay.length > 0 && totalPages > 1 && (
          <div className="mt-4">
            <DocumentsPagination
              id={`${id}-pagination`}
              currentPage={currentPage}
              totalItems={totalDocuments}
              itemsPerPage={pageSize}
              onPageChange={handlePageChange}
              onItemsPerPageChange={handlePageSizeChange}
              itemsPerPageOptions={viewMode === 'grid' ? gridPageSizeOptions : undefined}
            />
          </div>
        )}

        {/* Folder Selector Modal for New Documents (Entity Mode) */}
        <FolderSelectorModal
          isOpen={showDocumentFolderModal}
          onClose={() => setShowDocumentFolderModal(false)}
          onSelectFolder={handleDocumentFolderSelected}
          title={t('documents.folderSelector.newDocumentTitle', 'Select Folder for New Document')}
          description={t('documents.folderSelector.newDocumentDescription', 'Choose where to save this new document')}
          namespace={namespace}
        />

        {/* Folder Selector Modal for Moving Documents (Entity Mode) */}
        <FolderSelectorModal
          isOpen={showMoveFolderModal}
          onClose={() => {
            setShowMoveFolderModal(false);
            setDocumentToMove(null);
          }}
          onSelectFolder={handleMoveFolderSelected}
          title={t('documents.folderSelector.moveTitle', 'Move Document')}
          description={
            documentToMove
              ? t('documents.folderSelector.moveDescriptionWithName', {
                  name: documentToMove.document_name,
                  defaultValue: `Select destination folder for "${documentToMove.document_name}"`
                })
              : t('documents.folderSelector.moveDescription', 'Select destination folder')
          }
          namespace={namespace}
        />

        {/* Preview Modal for Images/Videos/PDFs */}
        {showPreviewModal && previewDocument && previewDocument.file_id && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75" onClick={() => setShowPreviewModal(false)}>
            <div className="relative max-w-7xl max-h-[90vh] w-full mx-4" onClick={(e) => e.stopPropagation()}>
              <button
                className="absolute top-4 right-4 text-white hover:text-gray-300 z-10"
                onClick={() => setShowPreviewModal(false)}
              >
                <X className="w-8 h-8" />
              </button>
              {previewDocument.mime_type?.startsWith('image/') && (
                <img
                  src={previewDocument.preview_file_id ? `/api/documents/${previewDocument.document_id}/preview` : `/api/documents/view/${previewDocument.file_id}`}
                  alt={previewDocument.document_name}
                  className="max-w-full max-h-[90vh] object-contain mx-auto"
                />
              )}
              {previewDocument.mime_type?.startsWith('video/') && (
                <video
                  src={`/api/documents/view/${previewDocument.file_id}`}
                  controls
                  className="max-w-full max-h-[90vh] mx-auto"
                />
              )}
              {previewDocument.mime_type === 'application/pdf' && (
                <iframe
                  src={`/api/documents/view/${previewDocument.file_id}`}
                  className="w-full h-[90vh] bg-white"
                  title={previewDocument.document_name}
                />
              )}
              <div className="mt-2 text-center text-white">
                <p className="text-lg font-medium">{previewDocument.document_name}</p>
              </div>
            </div>
          </div>
        )}

        <div className="document-drawer">
          <Drawer
            id={`${id}-document-drawer`}
            isOpen={isDrawerOpen}
            onClose={() => {
              setIsDrawerOpen(false);
              setDrawerError(null);
            }}
            isInDrawer={isInDrawer}
            hideCloseButton={true}
            drawerVariant="document"
          >
          <div className="flex flex-col h-full">
            <div className="flex justify-between items-center mb-4 pb-4">
              <h2 className="text-lg font-semibold">
                {isCreatingNew ? t('documents.newDocument', 'New Document') : (isEditModeInDrawer ? t('documents.editDocument', 'Edit Document') : t('documents.viewDocument', 'View Document'))}
              </h2>
              <div className="flex items-center space-x-2">
                {selectedDocument &&
                  (selectedDocument.type_name === 'text/plain' ||
                   selectedDocument.type_name === 'text/markdown' ||
                   (!selectedDocument.type_name && !selectedDocument.file_id)
                  ) && (
                  <Button
                    id={`${id}-download-pdf-btn`}
                    onClick={async () => {
                      if (selectedDocument) {
                        const downloadUrl = `/api/documents/download/${selectedDocument.document_id}?format=pdf`;
                        const filename = `${selectedDocument.document_name || 'document'}.pdf`;
                        try {
                          await downloadDocument(downloadUrl, filename, true);
                        } catch (error) {
                          console.error('Download failed:', error);
                        }
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
                      setDrawerError(null);
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
              {drawerError && (
                <div className="mb-4 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded">
                  {drawerError}
                </div>
              )}
              <div className="mb-4 relative p-0.5">
                <Input
                  id={`${id}-document-name`}
                  type="text"
                  placeholder="Document Name *"
                  value={isCreatingNew ? newDocumentName : documentName}
                  onChange={(e) => {
                    if (isCreatingNew || isEditModeInDrawer) {
                      if (isCreatingNew) {
                        setNewDocumentName(e.target.value);
                        setDrawerError(null); // Clear error when user types
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
                      <Spinner size="sm" />
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
                    setDrawerError(null);
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
                    variant="default"
                    className={isCreatingNew && !newDocumentName.trim() ? 'opacity-50' : ''}
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
