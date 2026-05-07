'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BlockNoteEditor, PartialBlock } from '@blocknote/core';
import type { Editor } from '@tiptap/react';
import type { IDocument, DocumentFilters } from '@alga-psa/types';
import DocumentStorageCard from './DocumentStorageCard';
import DocumentUpload from './DocumentUpload';
import Spinner from '@alga-psa/ui/components/Spinner';
import DocumentSelector from './DocumentSelector';
import DocumentsPagination from './DocumentsPagination';
import { DocumentsGridSkeleton } from './DocumentsPageSkeleton';
import { Button } from '@alga-psa/ui/components/Button';
import { CollapseToggleButton } from '@alga-psa/ui/components/CollapseToggleButton';
import Drawer from '@alga-psa/ui/components/Drawer';
import { Input } from '@alga-psa/ui/components/Input';
import { TextEditor } from '@alga-psa/ui/editor';
import { CollaborativeEditor } from './CollaborativeEditor';
import FolderTreeView from './FolderTreeView';
import FolderManager from './FolderManager';
import DocumentListView from './DocumentListView';
import ShareLinkDialog from './ShareLinkDialog';
import ViewSwitcher from '@alga-psa/ui/components/ViewSwitcher';
import FolderSelectorModal from './FolderSelectorModal';
import { Plus, Link, FileText, Edit3, Download, Grid, List as ListIcon, FolderPlus, X, FolderInput, Trash2, Printer } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { downloadDocument, getDocumentDownloadUrl } from '@alga-psa/documents/lib/documentUtils';
import toast from 'react-hot-toast';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { ReflectionContainer } from '@alga-psa/ui/ui-reflection/ReflectionContainer';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useRegisterUnsavedChanges } from '@alga-psa/ui/context';
import { useUserPreference } from '@alga-psa/user-composition/hooks';
import { getCurrentUser, searchUsersForMentions } from '@alga-psa/user-composition/actions';
import { getExperimentalFeatures } from '@alga-psa/tenancy/actions';
import {
  getDocumentsByEntity,
  getDocumentsByFolder,
  moveDocumentsToFolder,
  createFolder,
  deleteDocument,
  removeDocumentAssociations,
  updateDocument,
  toggleDocumentVisibility,
  ensureEntityFolders
} from '../actions/documentActions';
import {
  getBlockContent,
  updateBlockContent,
  createBlockDocument
} from '../actions/documentBlockContentActions';
import { syncCollabSnapshot } from '../actions/collaborativeEditingActions';
import { DocumentEditor } from './DocumentEditor';
import { DocumentViewer } from './DocumentViewer';

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

type DocumentsNamespace = 'common' | 'features/documents';
type CollabConnectionStatus = 'connecting' | 'connected' | 'disconnected';
type ProseMirrorDoc = { type: 'doc'; content: Record<string, unknown>[] };
type DocumentContent = PartialBlock[] | ProseMirrorDoc;

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
  uploadFormRef?: React.RefObject<HTMLDivElement | null>;
  filters?: DocumentFilters;
  namespace?: DocumentsNamespace;
  /** Override the default folder-fetching function (e.g. for client portal) */
  getFoldersFn?: () => Promise<string[]>;
  /** Skip folder chooser and upload directly into root scope. */
  forceUploadToRoot?: boolean;
  /** Allow share-link surfaces. */
  allowDocumentSharing?: boolean;
  /** Allow linking existing documents from broader document surfaces. */
  allowLinkExistingDocuments?: boolean;
  /** Allow creating rich-text/block documents from this surface. */
  allowBlockDocuments?: boolean;
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
  namespace = 'common',
  getFoldersFn,
  forceUploadToRoot = false,
  allowDocumentSharing = true,
  allowLinkExistingDocuments = true,
  allowBlockDocuments = true,
}: DocumentsProps): React.JSX.Element => {
  const { t } = useTranslation(namespace);
  const documentKeyPrefix = namespace === 'common' ? 'documents.' : '';
  const tDoc = (key: string, options?: Record<string, any> | string): string => {
    if (typeof options === 'string') {
      return t(`${documentKeyPrefix}${key}`, { defaultValue: options }) as string;
    }
    return t(`${documentKeyPrefix}${key}`, options) as string;
  };
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
  const [currentUserName, setCurrentUserName] = useState('');
  const [currentTenantId, setCurrentTenantId] = useState('');
  const [currentUserId, setCurrentUserId] = useState(userId);
  const [collabConnectionStatus, setCollabConnectionStatus] = useState<CollabConnectionStatus>('connecting');
  const [isFallbackMode, setIsFallbackMode] = useState(false);
  const collabStatusRef = useRef<CollabConnectionStatus>('connecting');
  const fallbackEditorRef = useRef<Editor | null>(null);
  const collabEditorRef = useRef<{ getJSON: () => Record<string, unknown> | null } | null>(null);
  const [fallbackContent, setFallbackContent] = useState<Record<string, any> | null>(null);
  const [fallbackHasUnsavedChanges, setFallbackHasUnsavedChanges] = useState(false);
  const preCreatedDocIdRef = useRef<string | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [newDocumentName, setNewDocumentName] = useState('');
  const [documentName, setDocumentName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [currentContent, setCurrentContent] = useState<DocumentContent>(DEFAULT_BLOCKS);
  const [hasContentChanged, setHasContentChanged] = useState(false);
  const editorRef = useRef<BlockNoteEditor | null>(null);
  const [isEditModeInDrawer, setIsEditModeInDrawer] = useState(false);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [editedDocumentId, setEditedDocumentId] = useState<string | null>(null);
  const [refreshTimestamp, setRefreshTimestamp] = useState<number>(0);
  const [showUnsavedChangesDialog, setShowUnsavedChangesDialog] = useState(false);
  const [visibilityUpdatingIds, setVisibilityUpdatingIds] = useState<Set<string>>(new Set());
  const [isClientUserContext, setIsClientUserContext] = useState(false);
  const [aiAssistantEnabled, setAiAssistantEnabled] = useState(false);
  const [shareDialogDocument, setShareDialogDocument] = useState<IDocument | null>(null);

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
      const folderParam = searchParams?.get('folder') ?? null;
      return folderParam || null;
    }
    return null;
  });
  const [selectedDocumentsForMove, setSelectedDocumentsForMove] = useState<Set<string>>(new Set());
  const isEditingDocument = Boolean(!isCreatingNew && selectedDocument && isEditModeInDrawer);
  const isCollaborativeEdit = Boolean(isEditingDocument && !isFallbackMode);

  const handleCollabConnectionStatusChange = useCallback((status: CollabConnectionStatus) => {
    collabStatusRef.current = status;
    setCollabConnectionStatus(status);
  }, []);

  useEffect(() => {
    if (!isEditingDocument || !selectedDocument) {
      setIsFallbackMode(false);
      return;
    }

    setIsFallbackMode(false);
    setCollabConnectionStatus('connecting');
    collabStatusRef.current = 'connecting';

    const timeout = setTimeout(() => {
      if (collabStatusRef.current !== 'connected') {
        setIsFallbackMode(true);
      }
    }, 3000);

    return () => {
      clearTimeout(timeout);
    };
  }, [isEditingDocument, selectedDocument?.document_id]);

  useEffect(() => {
    let mounted = true;

    const loadCurrentUser = async () => {
      try {
        const user = await getCurrentUser();
        if (!mounted || !user) return;
        const nameParts = [user.first_name, user.last_name].filter(Boolean);
        const displayName = nameParts.join(' ').trim() || user.email || 'User';
        setCurrentUserName(displayName);
        setCurrentTenantId(user.tenant ?? '');
        setCurrentUserId(user.user_id);
        setIsClientUserContext(user.user_type === 'client');
      } catch (loadError) {
        console.error('[Documents] Failed to load current user for collab editor:', loadError);
      }
    };

    const loadAiFeatureFlag = async () => {
      try {
        const features = await getExperimentalFeatures();
        if (!mounted) return;
        setAiAssistantEnabled(features.aiAssistant ?? false);
      } catch {
        // Feature flag not available — leave disabled
      }
    };

    void loadCurrentUser();
    void loadAiFeatureFlag();

    return () => {
      mounted = false;
    };
  }, []);

  // In entity mode, ensure default folders are created on first visit
  useEffect(() => {
    if (entityId && entityType) {
      void ensureEntityFolders(entityId, entityType);
    }
  }, [entityId, entityType]);

  // Sync currentFolder with URL changes (for breadcrumb/back-forward navigation)
  const prevSearchParamsRef = useRef(searchParams?.get('folder') ?? null);
  useEffect(() => {
    if (!entityId && !entityType) {
      const folderParam = searchParams?.get('folder') || null;
      // Only sync when the URL actually changed (avoids loop with handleFolderSelect)
      if (folderParam !== prevSearchParamsRef.current) {
        prevSearchParamsRef.current = folderParam;
        setCurrentFolder(folderParam);
      }
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

  // Track previous initialDocuments to avoid infinite loops
  const prevInitialDocumentsRef = useRef<string>('');

  // Sync documents from props when they change (e.g., after router.refresh() in entity mode)
  useEffect(() => {
    // In entity mode, sync from initialDocuments when they actually change
    if (!inFolderMode) {
      // Compare document IDs to detect actual changes (not just reference changes)
      const currentIds = initialDocuments.map(d => d.document_id).sort().join(',');
      if (currentIds !== prevInitialDocumentsRef.current) {
        prevInitialDocumentsRef.current = currentIds;
        setDocumentsToDisplay(initialDocuments);
        setTotalDocuments(initialDocuments.length);
      }
    }
  }, [initialDocuments, inFolderMode]);


  // Folder mode: fetch documents from server
  // Track all fetch dependencies to detect actual changes vs reference-only changes
  const prevFetchKeyRef = useRef<string>('');

  useEffect(() => {
    if (!inFolderMode) return;

    // Create a stable key from all dependencies that should trigger a fetch
    const currentFiltersString = JSON.stringify(filters || {});
    const fetchKey = `${currentPage}-${pageSize}-${currentFolder}-${currentFiltersString}`;

    // Skip if nothing actually changed (prevents fetch on reference-only filter changes)
    if (fetchKey === prevFetchKeyRef.current) {
      return;
    }
    prevFetchKeyRef.current = fetchKey;

    let cancelled = false;

    const fetchDocuments = async () => {
      try {
        const includeSubfolders = filters?.showAllDocuments || false;
        const folderToFetch = filters?.showAllDocuments ? null : currentFolder;

        const response = await getDocumentsByFolder(folderToFetch, includeSubfolders, currentPage, pageSize, filters);

        if (isActionPermissionError(response)) {
          if (!cancelled) {
            handleError(response.permissionError);
            setDocumentsToDisplay([]);
            setTotalPages(1);
          }
          return;
        }

        if (!cancelled) {
          setDocumentsToDisplay(response.documents);
          setTotalDocuments(response.total);
          setTotalPages(Math.ceil(response.total / pageSize));
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching documents by folder:', err);
          setError(tDoc('messages.fetchFailed', 'Failed to fetch documents.'));
          setDocumentsToDisplay([]);
          setTotalPages(1);
        }
      }
    };

    fetchDocuments();

    return () => {
      cancelled = true;
    };
  // Include filters in deps but use ref-based comparison to skip duplicate fetches
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, pageSize, inFolderMode, currentFolder, filters]);

  // Entity mode: handle search filtering
  useEffect(() => {
    if (inFolderMode) return;

    let filtered = initialDocuments;

    if (searchTermFromParent) {
      filtered = filtered.filter(doc =>
        doc.document_name.toLowerCase().includes(searchTermFromParent.toLowerCase())
      );
    }

    setDocumentsToDisplay(filtered);
  }, [searchTermFromParent, inFolderMode, initialDocuments]);

  // Refresh documents - handles both folder mode and entity mode
  const refreshDocuments = useCallback(async () => {
    if (inFolderMode) {
      // Folder mode: refetch from server
      try {
        const includeSubfolders = filters?.showAllDocuments || false;
        const folderToFetch = filters?.showAllDocuments ? null : currentFolder;
        const response = await getDocumentsByFolder(folderToFetch, includeSubfolders, currentPage, pageSize, filters);
        if (isActionPermissionError(response)) {
          handleError(response.permissionError);
          return;
        }
        setDocumentsToDisplay(response.documents);
        setTotalDocuments(response.total);
        setTotalPages(Math.ceil(response.total / pageSize));
      } catch (err) {
        console.error('Error refreshing documents:', err);
        setError(tDoc('messages.fetchFailed', 'Failed to fetch documents.'));
      }
    } else {
      // Entity mode: directly fetch updated documents
      if (entityId && entityType) {
        try {
          const response = await getDocumentsByEntity(entityId, entityType, filters, currentPage, pageSize);
          if (isActionPermissionError(response)) {
            handleError(response.permissionError);
            return;
          }
          setDocumentsToDisplay(response.documents);
          setTotalDocuments(response.totalCount);
          setTotalPages(response.totalPages);
        } catch (err) {
          console.error('Error refreshing entity documents:', err);
          setError(tDoc('messages.fetchFailed', 'Failed to fetch documents.'));
        }
      }
      // Also notify parent in case it needs to update other state
      if (onDocumentCreated) {
        onDocumentCreated();
      }
    }
  }, [inFolderMode, entityId, entityType, filters, currentFolder, currentPage, pageSize, onDocumentCreated, tDoc]);

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
      { value: '9', label: tDoc('pagination.perPage', { count: 9, defaultValue: '9 per page' }) },
      { value: '18', label: tDoc('pagination.perPage', { count: 18, defaultValue: '18 per page' }) },
      { value: '27', label: tDoc('pagination.perPage', { count: 27, defaultValue: '27 per page' }) },
      { value: '36', label: tDoc('pagination.perPage', { count: 36, defaultValue: '36 per page' }) }
    ],
    [t]
  );

  // Folder-specific handlers
  const handleFolderSelect = (folderPath: string | null) => {
    setCurrentFolder(folderPath);
    setCurrentPage(1); // Reset to first page when changing folders

    // Update URL to persist folder selection
    if (inFolderMode) {
      prevSearchParamsRef.current = folderPath;
      const params = new URLSearchParams(searchParams?.toString() ?? '');
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
        tDoc('messages.folderCreated', {
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
      handleError(error, tDoc('messages.folderCreateFailed', 'Failed to create folder'));
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : tDoc('messages.folderCreateFailed', 'Failed to create folder');
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
        targetFolder || tDoc('folders.root', 'Root');
      toast.success(
        tDoc('messages.moveDocumentsSuccess', {
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
      handleError(error, tDoc('messages.moveDocumentsFailed', 'Failed to move documents'));
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : tDoc('messages.moveDocumentsFailed', 'Failed to move documents');
      setError(errorMessage);
    }
  };

  const handleCreateDocument = async () => {
    if (inFolderMode && currentFolder) {
      // Folder mode: auto-save to current folder if browsing one
      setDocumentFolderPath(currentFolder);
      await handleDocumentFolderSelected(currentFolder);
    } else {
      // Show folder selector (both folder mode at root and entity mode)
      setShowDocumentFolderModal(true);
    }
  };

  const handleDocumentFolderSelected = async (folderPath: string | null) => {
    setDocumentFolderPath(folderPath);
    setShowDocumentFolderModal(false);

    const initialName = newDocumentName.trim() || tDoc('untitledDocument', 'Untitled Document');
    const emptyDoc = { type: 'doc', content: [{ type: 'paragraph' }] };

    try {
      setIsLoadingContent(true);
      const result = await createBlockDocument({
        document_name: initialName,
        user_id: currentUserId || userId,
        block_data: JSON.stringify(emptyDoc),
        entityId,
        entityType,
        folder_path: folderPath
      });

      if (isActionPermissionError(result)) {
        setDrawerError(result.permissionError);
        return;
      }

      preCreatedDocIdRef.current = result.document_id;
      setIsCreatingNew(true);
      setNewDocumentName('');
      setDocumentName('');
      setSelectedDocument({
        document_id: result.document_id,
        document_name: initialName,
        type_id: null,
        user_id: currentUserId || userId,
        order_number: 0,
        created_by: currentUserId || userId,
        tenant: currentTenantId,
      } as IDocument);
      setIsEditModeInDrawer(true);
      setHasContentChanged(false);
      setIsDrawerOpen(true);
    } catch (error) {
      console.error('Error creating document:', error);
      setDrawerError(
        tDoc('messages.createFailed', 'Failed to create document')
      );
    } finally {
      setIsLoadingContent(false);
    }
  };

  const handleContentChange = (blocks: PartialBlock[]) => {
    setCurrentContent(blocks);
    setHasContentChanged(true);
  };

  // Track unsaved document changes for navigation protection
  const hasUnsavedDocumentChanges = useMemo(() => {
    if (!isDrawerOpen) return false;
    if (isCreatingNew) {
      return hasContentChanged || newDocumentName.trim() !== '';
    }
    if (isFallbackMode && selectedDocument) {
      return fallbackHasUnsavedChanges || documentName !== selectedDocument.document_name;
    }
    if (isEditModeInDrawer && selectedDocument) {
      return hasContentChanged || documentName !== selectedDocument.document_name;
    }
    return false;
  }, [
    isDrawerOpen,
    isCreatingNew,
    hasContentChanged,
    newDocumentName,
    isFallbackMode,
    fallbackHasUnsavedChanges,
    isEditModeInDrawer,
    selectedDocument,
    documentName,
  ]);

  // Register with UnsavedChangesContext for browser navigation protection
  useRegisterUnsavedChanges(`document-editor-${id}`, hasUnsavedDocumentChanges);

  // Execute the actual drawer close (after confirmation or when no unsaved changes)
  // Resets all editor state back to saved values, matching the pattern in ContractDetail
  const executeDrawerClose = useCallback(() => {
    // NOTE: Do NOT call syncCollabSnapshot here. The drawer close unmounts
    // CollaborativeEditor which disconnects from Hocuspocus. The server-side
    // snapshot would race with that disconnect and read an empty room,
    // overwriting saved content. Content is saved explicitly via the Save button.

    // Clean up pre-created documents that were never fully saved
    if (preCreatedDocIdRef.current) {
      const orphanedId = preCreatedDocIdRef.current;
      preCreatedDocIdRef.current = null;
      void deleteDocument(orphanedId, userId).catch((deleteError) => {
        console.error('[Documents] Failed to clean up pre-created document:', deleteError);
      });
    }

    setShowUnsavedChangesDialog(false);
    setIsDrawerOpen(false);
    setDrawerError(null);
    setHasContentChanged(false);
    setFallbackHasUnsavedChanges(false);
    setFallbackContent(null);
    setIsFallbackMode(false);
    // Reset form fields to their saved values
    if (isCreatingNew) {
      setNewDocumentName('');
      setCurrentContent(DEFAULT_BLOCKS);
      setIsCreatingNew(false);
    } else if (selectedDocument) {
      setDocumentName(selectedDocument.document_name);
      setIsEditModeInDrawer(false);
    }
    setSelectedDocument(null);
  }, [isCreatingNew, selectedDocument, userId]);

  // Handle drawer close with unsaved changes check
  const handleDrawerClose = useCallback(() => {
    if (hasUnsavedDocumentChanges) {
      setShowUnsavedChangesDialog(true);
    } else {
      executeDrawerClose();
    }
  }, [hasUnsavedDocumentChanges, executeDrawerClose]);

  const handleDelete = useCallback(async (document: IDocument) => {
    // Note: Confirmation dialog is handled by DocumentStorageCard component
    const result = await deleteDocument(document.document_id, userId);

    if (!result.success) {
      const errorMessage =
        result.message || tDoc('messages.deleteFailed', 'Failed to delete document');
      toast.error(errorMessage);
      setError(errorMessage);
      return result;
    }

    setDocumentsToDisplay(prev => prev.filter(d => d.document_id !== document.document_id));
    toast.success(
      tDoc('messages.deleteSuccess', {
        name: document.document_name,
        defaultValue: `Document "${document.document_name}" deleted successfully`
      })
    );
    if (onDocumentCreated) {
      await onDocumentCreated();
    }

    return result;
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
        tDoc('messages.removeAssociationFailed', 'Failed to remove document association')
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
        tDoc('messages.moveDocumentSuccess', {
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
      handleError(error, tDoc('messages.moveDocumentFailed', 'Failed to move document'));
      const errorMessage =
        error instanceof Error && error.message
          ? error.message
          : tDoc('messages.moveDocumentFailed', 'Failed to move document');
      setError(errorMessage);
    }
  };

  const handleSaveNewDocument = async () => {
    try {
      const finalName = newDocumentName.trim() || tDoc('untitledDocument', 'Untitled Document');

      setIsSaving(true);
      setDrawerError(null);

      if (preCreatedDocIdRef.current) {
        // Update the pre-created document with final name and content
        const docId = preCreatedDocIdRef.current;
        await updateDocument(docId, {
          document_name: finalName,
          edited_by: userId
        });
        await updateBlockContent(docId, {
          block_data: JSON.stringify(currentContent),
          user_id: userId
        });
        preCreatedDocIdRef.current = null;
      } else {
        // Fallback: create new if pre-creation didn't happen
        await createBlockDocument({
          document_name: finalName,
          user_id: userId,
          block_data: JSON.stringify(currentContent),
          entityId,
          entityType,
          folder_path: documentFolderPath
        });
      }

      // Refresh the document list (triggers router.refresh() in entity mode)
      await refreshDocuments();

      // Reset folder selection for next document
      setDocumentFolderPath(null);

      setIsCreatingNew(false);
      setIsDrawerOpen(false);
    } catch (error) {
      console.error('Error creating document:', error);
      setDrawerError(
        tDoc('messages.createFailed', 'Failed to create document')
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
        tDoc('messages.saveFailed', 'Failed to save document')
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCollabSnapshot = async () => {
    try {
      if (!selectedDocument) return;
      setIsSaving(true);

      // For new documents or when the name changed, update the document name
      const finalName = isCreatingNew
        ? (newDocumentName.trim() || tDoc('untitledDocument', 'Untitled Document'))
        : documentName;

      if (finalName !== selectedDocument.document_name) {
        await updateDocument(selectedDocument.document_id, {
          document_name: finalName,
          edited_by: userId
        });
      }

      const result = await syncCollabSnapshot(selectedDocument.document_id);
      if (!result.success) {
        // Fallback: save content directly from the client-side editor
        const editorJson = collabEditorRef.current?.getJSON();
        if (editorJson) {
          await updateBlockContent(selectedDocument.document_id, {
            block_data: JSON.stringify(editorJson),
            user_id: userId
          });
        } else {
          setDrawerError(result.message || tDoc('messages.saveFailed', 'Failed to save document'));
          return;
        }
      }

      preCreatedDocIdRef.current = null;
      setEditedDocumentId(selectedDocument.document_id);
      setRefreshTimestamp(Date.now());

      setIsDrawerOpen(false);
      setDrawerError(null);
      setHasContentChanged(false);
      setFallbackHasUnsavedChanges(false);
      setFallbackContent(null);
      setIsFallbackMode(false);
      setIsCreatingNew(false);
      setIsEditModeInDrawer(false);
      setSelectedDocument(null);
    } catch (error) {
      console.error('Error saving document snapshot:', error);
      setDrawerError(
        tDoc('messages.saveFailed', 'Failed to save document')
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveFallback = async () => {
    try {
      if (!selectedDocument) return;
      setIsSaving(true);

      const finalName = isCreatingNew
        ? (newDocumentName.trim() || tDoc('untitledDocument', 'Untitled Document'))
        : documentName;

      if (finalName !== selectedDocument.document_name) {
        await updateDocument(selectedDocument.document_id, {
          document_name: finalName,
          edited_by: userId
        });
      }

      const content = fallbackEditorRef.current?.getJSON()
        || fallbackContent
        || { type: 'doc', content: [{ type: 'paragraph' }] };

      await updateBlockContent(selectedDocument.document_id, {
        block_data: JSON.stringify(content),
        user_id: currentUserId || userId
      });

      preCreatedDocIdRef.current = null;
      setEditedDocumentId(selectedDocument.document_id);
      setRefreshTimestamp(Date.now());

      setIsDrawerOpen(false);
      setDrawerError(null);
      setHasContentChanged(false);
      setFallbackHasUnsavedChanges(false);
      setFallbackContent(null);
      setIsFallbackMode(false);
      setIsCreatingNew(false);
      setIsEditModeInDrawer(false);
      setSelectedDocument(null);
    } catch (error) {
      console.error('Error saving fallback document content:', error);
      setDrawerError(
        tDoc('messages.saveFailed', 'Failed to save document')
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
          if (content && !isActionPermissionError(content) && content.block_data) {
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
            tDoc('messages.loadContentFailed', 'Failed to load document content')
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
  const showVisibilityControls = !isClientUserContext;

  // Use refs to store click handlers to avoid recreating them
  const clickHandlersRef = useRef<Map<string, () => void>>(new Map());
  const moveHandlersRef = useRef<Map<string, () => void>>(new Map());

  const handleDocumentClick = async (document: IDocument) => {
    // For in-app documents (no file_id), open in drawer/editor
    if (!document.file_id) {
      setSelectedDocument(document);
      setDocumentName(document.document_name);
      setIsCreatingNew(false);
      setHasContentChanged(false);
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
      handleError(error, tDoc('messages.downloadFailed', 'Failed to download document'));
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

  const handleToggleDocumentVisibility = async (document: IDocument, nextValue: boolean) => {
    const previousValue = Boolean(document.is_client_visible);

    setVisibilityUpdatingIds((previous) => {
      const next = new Set(previous);
      next.add(document.document_id);
      return next;
    });

    setDocumentsToDisplay((previousDocuments) =>
      previousDocuments.map((item) =>
        item.document_id === document.document_id
          ? { ...item, is_client_visible: nextValue }
          : item
      )
    );

    try {
      const result = await toggleDocumentVisibility([document.document_id], nextValue);

      if (isActionPermissionError(result)) {
        handleError(result.permissionError);
        setDocumentsToDisplay((previousDocuments) =>
          previousDocuments.map((item) =>
            item.document_id === document.document_id
              ? { ...item, is_client_visible: previousValue }
              : item
          )
        );
        return;
      }

      if (result === 0) {
        setDocumentsToDisplay((previousDocuments) =>
          previousDocuments.map((item) =>
            item.document_id === document.document_id
              ? { ...item, is_client_visible: previousValue }
              : item
          )
        );
        toast.error(tDoc('messages.visibilityToggleFailed', 'Failed to update visibility'));
      }
    } catch (error) {
      setDocumentsToDisplay((previousDocuments) =>
        previousDocuments.map((item) =>
          item.document_id === document.document_id
            ? { ...item, is_client_visible: previousValue }
            : item
        )
      );
      handleError(error, tDoc('messages.visibilityToggleFailed', 'Failed to update visibility'));
    } finally {
      setVisibilityUpdatingIds((previous) => {
        const next = new Set(previous);
        next.delete(document.document_id);
        return next;
      });
    }
  };

  const handleShareDocument = useCallback((doc: IDocument) => {
    setShareDialogDocument(doc);
  }, []);

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
            showVisibilityControls={showVisibilityControls}
            onToggleVisibility={handleToggleDocumentVisibility}
            isVisibilityUpdating={visibilityUpdatingIds.has(document.document_id)}
            onShare={allowDocumentSharing ? handleShareDocument : undefined}
            forceRefresh={editedDocumentId === document.document_id ? refreshTimestamp : undefined}
            onClick={getOrCreateClickHandler(document)}
            isContentDocument={!document.file_id}
          />
        </div>
      );
    });
  };

  const getSaveHandler = () => {
    if (isCreatingNew) {
      return selectedDocument
        ? isFallbackMode ? handleSaveFallback : handleSaveCollabSnapshot
        : handleSaveNewDocument;
    }
    if (isFallbackMode) return handleSaveFallback;
    if (isCollaborativeEdit) return handleSaveCollabSnapshot;
    return handleSaveChanges;
  };

  const isSaveDisabled =
    isSaving
    || (isFallbackMode
      ? !fallbackHasUnsavedChanges && documentName === selectedDocument?.document_name
      : false)
    || (!isCollaborativeEdit
      && !isFallbackMode
      && !hasContentChanged
      && !isCreatingNew
      && documentName === selectedDocument?.document_name);

  const renderDrawerBody = () => (
    <div className="flex flex-col h-full">
      <div className="flex justify-between items-center mb-4 pb-4">
        <h2 className="text-lg font-semibold">
          {isCreatingNew ? tDoc('newDocument', 'New Document') : (isEditModeInDrawer ? tDoc('editDocument', 'Edit Document') : tDoc('viewDocument', 'View Document'))}
        </h2>
        <div className="flex items-center space-x-2">
          {selectedDocument &&
            (selectedDocument.type_name === 'text/plain' ||
             selectedDocument.type_name === 'text/markdown' ||
             (!selectedDocument.type_name && !selectedDocument.file_id)
            ) && (
            <>
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
              <Button
                id={`${id}-download-md-btn`}
                onClick={async () => {
                  if (selectedDocument) {
                    const downloadUrl = `/api/documents/download/${selectedDocument.document_id}?format=markdown`;
                    const filename = `${selectedDocument.document_name || 'document'}.md`;
                    try {
                      await downloadDocument(downloadUrl, filename, true);
                    } catch (error) {
                      console.error('Markdown download failed:', error);
                    }
                  }
                }}
                variant="outline"
                size="sm"
              >
                <FileText className="w-4 h-4 mr-2" />
                Markdown
              </Button>
              <Button
                id={`${id}-print-document-btn`}
                onClick={async () => {
                  if (!selectedDocument) return;
                  try {
                    const res = await fetch(
                      `/api/documents/download/${selectedDocument.document_id}?format=pdf`,
                    );
                    if (!res.ok) throw new Error(`Print fetch failed: ${res.status}`);
                    const blob = await res.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    const printWindow = window.open(blobUrl, '_blank');
                    if (printWindow) {
                      printWindow.addEventListener('load', () => {
                        printWindow.focus();
                        printWindow.print();
                      });
                    }
                    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
                  } catch (error) {
                    console.error('Print failed:', error);
                  }
                }}
                variant="outline"
                size="sm"
              >
                <Printer className="w-4 h-4 mr-2" />
                Print
              </Button>
            </>
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
              onClick={handleDrawerClose}
              variant="ghost"
            >
              ×
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col">
        {drawerError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{drawerError}</AlertDescription>
          </Alert>
        )}
        <div className="mb-4 relative p-0.5">
          <Input
            id={`${id}-document-name`}
            type="text"
            placeholder={tDoc('untitledDocument', 'Untitled Document')}
            value={isCreatingNew ? newDocumentName : documentName}
            onChange={(e) => {
              if (isCreatingNew || isEditModeInDrawer) {
                if (isCreatingNew) {
                  setNewDocumentName(e.target.value);
                  setDocumentName(e.target.value);
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
            {isFallbackMode && (
              <div className="mb-2 rounded border border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/30 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                {tDoc('offlineManualSave', 'Offline — manual save mode')}
              </div>
            )}
            {isLoadingContent ? (
              <div className="flex justify-center items-center h-full">
                <Spinner size="sm" />
              </div>
            ) : isCreatingNew && !selectedDocument ? (
              <TextEditor
                key="editor-new"
                id={`${id}-editor`}
                initialContent={currentContent as PartialBlock[]}
                onContentChange={handleContentChange}
                editorRef={editorRef}
                searchMentions={searchUsersForMentions}
              />
            ) : selectedDocument && (isEditModeInDrawer || isCreatingNew) ? (
              isFallbackMode ? (
                <DocumentEditor
                  documentId={selectedDocument.document_id}
                  userId={currentUserId || userId}
                  editorRef={fallbackEditorRef}
                  onContentChange={setFallbackContent}
                  onUnsavedChangesChange={setFallbackHasUnsavedChanges}
                  hideSaveButton={true}
                />
              ) : (
                <CollaborativeEditor
                  documentId={selectedDocument.document_id}
                  tenantId={selectedDocument.tenant ?? currentTenantId}
                  userId={currentUserId || userId}
                  userName={currentUserName || userId}
                  editorRef={collabEditorRef}
                  searchMentions={searchUsersForMentions}
                  aiAssistantEnabled={aiAssistantEnabled}
                  onConnectionStatusChange={handleCollabConnectionStatusChange}
                />
              )
            ) : selectedDocument ? (
              <DocumentViewer content={currentContent} />
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
            onClick={handleDrawerClose}
            variant="outline"
          >
            Cancel
          </Button>
          {(isCreatingNew || isEditModeInDrawer) && (
            <Button
              id={`${id}-save-btn`}
              onClick={getSaveHandler()}
              disabled={isSaveDisabled}
              variant="default"
              className={isCreatingNew && !newDocumentName.trim() ? 'opacity-50' : ''}
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );

  // Folder mode: show folder tree sidebar and new layout
  if (inFolderMode) {
    return (
      <ReflectionContainer id={id} label="Documents">
        <div className="flex flex-col h-[calc(100vh-200px)]">
          {/* Header with Actions */}
          <div className="border-b border-gray-200 dark:border-[rgb(var(--color-border-200))] p-4 flex items-center justify-between">
            <div className="flex items-center gap-2">

              {/* New Document Button */}
              {allowBlockDocuments && (
              <Button
                id={`${id}-new-document-btn`}
                variant="default"
                onClick={handleCreateDocument}
              >
                <FileText className="w-4 h-4 mr-2" />
                New Document
              </Button>
              )}

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
              onChange={(view: string) => setViewMode(view as 'grid' | 'list')}
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
              <div className="flex-shrink-0 border-r border-gray-200 dark:border-[rgb(var(--color-border-200))] flex items-start p-2">
                <CollapseToggleButton
                  id="documents-show-folders-button"
                  isCollapsed={true}
                  collapsedLabel="Show folders"
                  expandedLabel="Collapse folders"
                  expandDirection="right"
                  onClick={() => setIsFoldersPaneCollapsed(false)}
                />
              </div>
            )}

            {/* Folder Navigation Sidebar */}
            {!isFoldersPaneCollapsed && (
              <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-[rgb(var(--color-border-200))]">
                <FolderTreeView
                  key={folderTreeKey}
                  selectedFolder={currentFolder}
                  onFolderSelect={handleFolderSelect}
                  entityId={entityId}
                  entityType={entityType}
                  showVisibilityIndicators={showVisibilityControls}
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
              <div ref={uploadFormRef} className="m-4 p-4 border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-md bg-white dark:bg-[rgb(var(--color-card))]">
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
                  getFoldersFn={getFoldersFn}
                />
              </div>
            )}

            {/* Document Display */}
            <div className="flex-1 overflow-y-auto p-4">
              {isLoading ? (
                <DocumentsGridSkeleton gridColumns={3} />
              ) : error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : (
                <>
                  {/* Bulk Actions Toolbar */}
                  {selectedDocumentsForMove.size > 0 && viewMode === 'list' && (
                    <div className="mb-4 p-3 bg-[rgb(var(--color-primary-50))] dark:bg-[rgb(var(--color-primary-900))]/20 border border-[rgb(var(--color-primary-200))] dark:border-[rgb(var(--color-primary-800))] rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <span className="text-sm font-medium text-[rgb(var(--color-primary-900))] dark:text-[rgb(var(--color-primary-100))]">
                          {tDoc('bulkActions.selected', {
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
                              {tDoc('bulkActions.moveToFolder', 'Move to Folder')}
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
                                  tDoc('prompts.confirmBulkDelete', {
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
                                  return doc ? deleteDocument(docId, userId) : Promise.resolve(null);
                                });
                                const results = await Promise.all(deletePromises);
                                const failed = results.filter(
                                  (result) => result && 'success' in result && !result.success
                                );
                                if (failed.length > 0) {
                                  toast.error(
                                    tDoc('messages.bulkDeleteFailed', 'Failed to delete some documents')
                                  );
                                } else {
                                  toast.success(
                                    tDoc('messages.bulkDeleteSuccess', {
                                      count,
                                      defaultValue: `${count} document${count !== 1 ? 's' : ''} deleted successfully`
                                    })
                                  );
                                }
                                setSelectedDocumentsForMove(new Set());
                                await refreshDocuments();
                              } catch (error) {
                                handleError(error, tDoc('messages.bulkDeleteFailed', 'Failed to delete some documents'));
                              }
                            }}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            {tDoc('bulkActions.deleteSelected', 'Delete Selected')}
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
                        {tDoc('bulkActions.clearSelection', 'Clear Selection')}
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
                      showVisibilityControls={showVisibilityControls}
                      onToggleVisibility={handleToggleDocumentVisibility}
                      visibilityUpdatingIds={visibilityUpdatingIds}
                      showShareControls={true}
                      onShare={allowDocumentSharing ? handleShareDocument : undefined}
                    />
                  ) : (
                    documentsToDisplay.length > 0 ? (
                      <div className={`grid ${gridColumnsClass} gap-4`}>
                        {renderDocumentCards()}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
                        {tDoc('empty.folder', 'No documents found in this folder')}
                      </div>
                    )
                  )}
                </>
              )}
            </div>

            {/* Pagination */}
            {documentsToDisplay.length > 0 && totalPages > 1 && (
              <div className="border-t border-gray-200 dark:border-[rgb(var(--color-border-200))] p-4">
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
            title={tDoc('folderSelector.newDocumentTitle', 'Select Folder for New Document')}
            description={tDoc('folderSelector.newDocumentDescription', 'Choose where to save this new document')}
            namespace={namespace}
            entityId={entityId}
            entityType={entityType}
            getFoldersFn={getFoldersFn}
          />

          {/* Folder Selector Modal for Moving Documents */}
          <FolderSelectorModal
            isOpen={showMoveFolderModal}
            onClose={() => {
              setShowMoveFolderModal(false);
              setDocumentToMove(null);
            }}
            onSelectFolder={handleMoveFolderSelected}
            title={tDoc('folderSelector.moveTitle', 'Move Document')}
            description={
              documentToMove
                ? tDoc('folderSelector.moveDescriptionWithName', {
                    name: documentToMove.document_name,
                    defaultValue: `Select destination folder for "${documentToMove.document_name}"`
                  })
                : tDoc('folderSelector.moveDescription', 'Select destination folder')
            }
            namespace={namespace}
            entityId={entityId}
            entityType={entityType}
            getFoldersFn={getFoldersFn}
          />

          {/* Folder Selector Modal for Bulk Moving Documents */}
          <FolderSelectorModal
            isOpen={showBulkMoveFolderModal}
            onClose={() => {
              setShowBulkMoveFolderModal(false);
            }}
            onSelectFolder={handleMoveDocuments}
            title={tDoc('folderSelector.bulkMoveTitle', 'Move Selected Documents')}
            description={tDoc('folderSelector.bulkMoveDescription', {
              count: selectedDocumentsForMove.size,
              defaultValue: `Select destination folder for ${selectedDocumentsForMove.size} document${selectedDocumentsForMove.size !== 1 ? 's' : ''}`
            })}
            namespace={namespace}
            entityId={entityId}
            entityType={entityType}
            getFoldersFn={getFoldersFn}
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
            onClose={handleDrawerClose}
            isInDrawer={isInDrawer}
            hideCloseButton={true}
            drawerVariant="document"
          >
          {renderDrawerBody()}
          </Drawer>
        </div>

        {/* Unsaved Changes Confirmation Dialog */}
        <ConfirmationDialog
          id={`${id}-unsaved-changes-dialog`}
          isOpen={showUnsavedChangesDialog}
          onClose={() => setShowUnsavedChangesDialog(false)}
          onConfirm={executeDrawerClose}
          title="Unsaved Changes"
          message="Are you sure you want to cancel? Any unsaved changes will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Continue editing"
        />

        {allowDocumentSharing && shareDialogDocument && (
          <ShareLinkDialog
            isOpen={true}
            onClose={() => setShareDialogDocument(null)}
            documentId={shareDialogDocument.document_id}
            documentName={shareDialogDocument.document_name}
          />
        )}
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
            {allowBlockDocuments && (
            <Button
              id={`${id}-new-document-btn`}
              onClick={handleCreateDocument}
              variant="default"
            >
              <FileText className="w-4 h-4 mr-2" />
              {tDoc('newDocument', 'New Document')}
            </Button>
            )}
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
              {tDoc('uploadFile', 'Upload File')}
            </Button>
            {entityId && entityType && allowLinkExistingDocuments && (
              <Button
                id={`${id}-link-documents-btn`}
                onClick={() => setShowSelector(true)}
                variant="default"
                data-testid="link-documents-button"
              >
                <Link className="w-4 h-4 mr-2" />
                {tDoc('linkDocuments', 'Link Documents')}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-4">
            {showUpload && (
              <div ref={uploadFormRef} className="p-4 border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-md bg-white dark:bg-[rgb(var(--color-card))]">
                <DocumentUpload
                  id={`${id}-upload`}
                  userId={userId}
                  entityId={entityId}
                  entityType={entityType}
                  folderPath={forceUploadToRoot ? null : undefined}
                  onUploadComplete={async () => {
                    setShowUpload(false);
                    // Refresh the documents list (triggers router.refresh() in entity mode)
                    await refreshDocuments();
                  }}
                  onCancel={() => setShowUpload(false)}
                  getFoldersFn={getFoldersFn}
                />
              </div>
            )}

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {isLoading ? (
              <DocumentsGridSkeleton gridColumns={gridColumns} />
            ) : documentsToDisplay.length > 0 ? (
              <div className={`grid ${gridColumnsClass} gap-4`}>
                {renderDocumentCards()}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-md">
                {tDoc('empty.default', 'No documents found')}
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
        </div>

        {allowLinkExistingDocuments && showSelector && entityId && entityType ? (
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
            onClose={handleDrawerClose}
            isInDrawer={isInDrawer}
            hideCloseButton={true}
            drawerVariant="document"
          >
          {renderDrawerBody()}
          </Drawer>
        </div>

        {/* Folder Selector Modal for New Documents (entity mode) */}
        <FolderSelectorModal
          isOpen={showDocumentFolderModal}
          onClose={() => setShowDocumentFolderModal(false)}
          onSelectFolder={handleDocumentFolderSelected}
          title={tDoc('folderSelector.newDocumentTitle', 'Select Folder for New Document')}
          description={tDoc('folderSelector.newDocumentDescription', 'Choose where to save this new document')}
          namespace={namespace}
          entityId={entityId}
          entityType={entityType}
          getFoldersFn={getFoldersFn}
        />

        {/* Unsaved Changes Confirmation Dialog */}
        <ConfirmationDialog
          id={`${id}-unsaved-changes-dialog`}
          isOpen={showUnsavedChangesDialog}
          onClose={() => setShowUnsavedChangesDialog(false)}
          onConfirm={executeDrawerClose}
          title="Unsaved Changes"
          message="Are you sure you want to cancel? Any unsaved changes will be lost."
          confirmLabel="Discard changes"
          cancelLabel="Continue editing"
        />
      </div>

      {allowDocumentSharing && shareDialogDocument && (
        <ShareLinkDialog
          isOpen={true}
          onClose={() => setShareDialogDocument(null)}
          documentId={shareDialogDocument.document_id}
          documentName={shareDialogDocument.document_name}
        />
      )}
    </ReflectionContainer>
  );
};

export default Documents;
