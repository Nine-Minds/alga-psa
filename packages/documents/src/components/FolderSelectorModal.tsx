'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { getFolders, createFolder } from '../actions/documentActions';
import { getDefaultFolders } from '../actions/defaultFolderActions';
import { handleError, isActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { Folder, Home, ChevronRight, FolderPlus, X, FolderOpen } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

interface FolderSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder: (folderPath: string | null) => void;
  title?: string;
  description?: string;
  namespace?: 'common' | 'features/documents';
  entityId?: string;
  entityType?: string;
  /** Override the default folder-fetching function (e.g. for client portal) */
  getFoldersFn?: () => Promise<string[]>;
}

export default function FolderSelectorModal({
  isOpen,
  onClose,
  onSelectFolder,
  title: titleProp,
  description: descriptionProp,
  namespace = 'common',
  entityId,
  entityType,
  getFoldersFn
}: FolderSelectorModalProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const { t } = useTranslation(namespace);
  const { t: tCommon } = useTranslation('common');
  const documentKeyPrefix = namespace === 'common' ? 'documents.' : '';
  const tDoc = (key: string, options?: Record<string, any> | string): string => {
    if (typeof options === 'string') {
      return t(`${documentKeyPrefix}${key}`, { defaultValue: options }) as string;
    }
    return t(`${documentKeyPrefix}${key}`, options) as string;
  };
  const title = titleProp ?? tDoc('folderSelector.defaultTitle', 'Select Destination Folder');
  const description = descriptionProp ?? tDoc('folderSelector.defaultDescription', 'Choose where to save this document');

  // New folder creation state
  const [showNewFolderInput, setShowNewFolderInput] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllFolders, setShowAllFolders] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setShowAllFolders(false);
      loadFolders(false);
      // Reset new folder state when modal opens
      setShowNewFolderInput(false);
      setNewFolderName('');
      setNewFolderParent(null);
      setError(null);
      // In entity mode, don't default to null (root) — wait for folders to load
      if (!entityId) {
        setSelectedFolder(null);
      }
    }
  }, [isOpen]);

  const loadFolders = async (allFolders?: boolean) => {
    setLoading(true);
    try {
      let folderList: string[] = [];
      if (getFoldersFn) {
        folderList = await getFoldersFn();
      } else if (!entityId && entityType && !allFolders) {
        // No entity yet (e.g. creating a new task) — show default folder
        // templates for the entity type so the user can still pick a folder.
        const defaults = await getDefaultFolders(entityType);
        if (isActionPermissionError(defaults)) {
          handleError(defaults.permissionError);
          setFolders([]);
          return;
        }
        folderList = defaults.map(d => d.folder_path);
      } else {
        // When showAll is true, fetch without entity scope to get all folders
        const scopedEntityId = allFolders ? undefined : entityId;
        const scopedEntityType = allFolders ? undefined : entityType;
        const result = await getFolders(scopedEntityId, scopedEntityType);
        if (isActionPermissionError(result)) {
          handleError(result.permissionError);
          setFolders([]);
          return;
        }
        folderList = result;
      }
      setFolders(folderList);
      // Auto-select the first folder when in entity/template context
      if ((entityId || entityType) && !allFolders && folderList.length > 0) {
        setSelectedFolder(folderList[0]);
      }
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleShowAll = () => {
    const newValue = !showAllFolders;
    setShowAllFolders(newValue);
    setSelectedFolder(null);
    loadFolders(newValue);
  };

  const handleConfirm = () => {
    onSelectFolder(selectedFolder);
    onClose();
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) {
      setError(tDoc('folderSelector.errors.nameRequired', 'Please enter a folder name'));
      return;
    }

    // Validate folder name - no slashes allowed
    if (newFolderName.includes('/')) {
      setError(tDoc('folderSelector.errors.invalidCharacters', 'Folder name cannot contain "/"'));
      return;
    }

    setCreatingFolder(true);
    setError(null);

    try {
      // Build the full folder path
      const folderPath = newFolderParent
        ? `${newFolderParent}/${newFolderName.trim()}`
        : `/${newFolderName.trim()}`;

      // createFolder requires both entityId and entityType or neither.
      // When we only have entityType (template mode for new entities), create
      // the folder without entity scoping.
      const hasFullEntityScope = Boolean(entityId && entityType) && !showAllFolders;
      const scopedEntityId = hasFullEntityScope ? entityId : undefined;
      const scopedEntityType = hasFullEntityScope ? entityType : undefined;
      const createResult = await createFolder(folderPath, scopedEntityId, scopedEntityType);
      if (isActionPermissionError(createResult)) {
        handleError(createResult.permissionError);
        return;
      }

      // Reload folders to show the new one
      await loadFolders(showAllFolders);

      // Reset the new folder form
      setShowNewFolderInput(false);
      setNewFolderName('');
      setNewFolderParent(null);

      // Auto-select the newly created folder
      setSelectedFolder(folderPath);
    } catch (err) {
      console.error('Error creating folder:', err);
      setError(
        err instanceof Error && err.message
          ? err.message
          : tDoc('folderSelector.errors.createFailed', 'Failed to create folder')
      );
    } finally {
      setCreatingFolder(false);
    }
  };

  const handleCancelNewFolder = () => {
    setShowNewFolderInput(false);
    setNewFolderName('');
    setNewFolderParent(null);
    setError(null);
  };

  const handleStartNewFolder = () => {
    setShowNewFolderInput(true);
    // Use currently selected folder as parent, or null for root
    setNewFolderParent(selectedFolder);
    setError(null);
  };

  const renderFolderTree = (folders: string[]) => {
    // Group folders by depth for hierarchical display
    return folders.map((folder) => {
      const depth = folder.split('/').filter(p => p).length - 1;
      const folderName = folder.split('/').filter(p => p).pop() || folder;

      return (
        <button
          key={folder}
          type="button"
          onClick={() => setSelectedFolder(folder)}
          className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] ${
            selectedFolder === folder ? 'bg-purple-50 dark:bg-[rgb(var(--color-border-100))] text-purple-700 dark:text-[rgb(var(--color-primary-300))] font-medium border-l-2 border-purple-500 dark:border-[rgb(var(--color-primary-500))]' : 'text-gray-700 dark:text-[rgb(var(--color-text-400))]'
          }`}
          style={{ paddingLeft: `${(depth + 1) * 12 + 12}px` }}
        >
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 flex-shrink-0" />
            <span className="truncate">{folderName}</span>
            <span className="text-xs text-gray-400 ml-auto">{folder}</span>
          </div>
        </button>
      );
    });
  };

  return (
    <Dialog isOpen={isOpen} onClose={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-gray-500">{description}</p>
        </DialogHeader>

        {/* New Folder Creation Section */}
        {showNewFolderInput ? (
          <div className="border border-purple-200 dark:border-[rgb(var(--color-border-200))] rounded-md p-4 bg-purple-50 dark:bg-[rgb(var(--color-border-50))] space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-900 dark:text-[rgb(var(--color-text-900))] flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-purple-600" />
                {tDoc('folderSelector.createTitle', 'Create New Folder')}
              </h4>
              <button
                id="cancel-new-folder-btn"
                type="button"
                onClick={handleCancelNewFolder}
                className="text-gray-400 hover:text-gray-600"
                disabled={creatingFolder}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                {tDoc('folderSelector.parentLabel', {
                  folder: newFolderParent || tDoc('folderSelector.rootLabel', '/ (Root)'),
                  defaultValue: `Parent folder: ${newFolderParent || '/ (Root)'}`
                })}
              </label>
            </div>

            <div className="space-y-2">
              <Input
                id="new-folder-name-input"
                type="text"
                placeholder={tDoc('folderSelector.namePlaceholder', 'Enter folder name')}
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFolder();
                  } else if (e.key === 'Escape') {
                    handleCancelNewFolder();
                  }
                }}
                disabled={creatingFolder}
                className="w-full"
                autoFocus
              />
              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}
            </div>

            <div className="flex gap-2 justify-end">
              <Button
                id="cancel-folder-creation-btn"
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelNewFolder}
                disabled={creatingFolder}
              >
                {tCommon('cancel', 'Cancel')}
              </Button>
              <Button
                id="create-folder-btn"
                type="button"
                size="sm"
                onClick={handleCreateFolder}
                disabled={creatingFolder || !newFolderName.trim()}
              >
                {creatingFolder
                  ? tDoc('folderSelector.creating', 'Creating...')
                  : tDoc('folderSelector.createButton', 'Create Folder')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex justify-between items-center">
            {(entityId || entityType) && !getFoldersFn ? (
              <button
                type="button"
                onClick={handleToggleShowAll}
                disabled={loading}
                className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded transition-colors ${
                  showAllFolders
                    ? 'text-purple-700 dark:text-[rgb(var(--color-primary-300))] bg-purple-50 dark:bg-[rgb(var(--color-border-100))]'
                    : 'text-gray-500 dark:text-[rgb(var(--color-text-400))] hover:text-gray-700 dark:hover:text-[rgb(var(--color-text-600))]'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {showAllFolders
                  ? tDoc('folderSelector.showEntityFolders', 'Show entity folders')
                  : tDoc('folderSelector.showAllFolders', 'Show all folders')}
              </button>
            ) : (
              <div />
            )}
            <Button
              id="new-folder-btn"
              type="button"
              variant="outline"
              size="sm"
              onClick={handleStartNewFolder}
              disabled={loading}
              className="flex items-center gap-2"
            >
              <FolderPlus className="w-4 h-4" />
              {tDoc('folderSelector.newFolderButton', 'New Folder')}
            </Button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-md p-2 space-y-1">
          {loading ? (
            <div className="text-center py-8 text-gray-500">
              {tDoc('folderSelector.loading', 'Loading folders...')}
            </div>
          ) : (
            <>
              {/* Root option — shown when not scoped to an entity, or when "show all" is active */}
              {(!entityId || showAllFolders) && (
                <button
                  type="button"
                  onClick={() => setSelectedFolder(null)}
                  className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-[rgb(var(--color-border-100))] ${
                    selectedFolder === null ? 'bg-purple-50 dark:bg-[rgb(var(--color-border-100))] text-purple-700 dark:text-[rgb(var(--color-primary-300))] font-medium border-l-2 border-purple-500 dark:border-[rgb(var(--color-primary-500))]' : 'text-gray-700 dark:text-[rgb(var(--color-text-400))]'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Home className="w-4 h-4" />
                    <span>{tDoc('folderSelector.rootOption', 'Root (No folder)')}</span>
                  </div>
                </button>
              )}

              {/* Folder tree */}
              {folders.length > 0 ? (
                renderFolderTree(folders)
              ) : (
                <div className="text-center py-4 text-sm text-gray-500">
                  {tDoc(
                    'folderSelector.empty',
                    'No folders available. Documents will be saved to root.'
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            id="folder-selector-cancel-btn"
            variant="outline"
            onClick={onClose}
          >
            {tCommon('cancel', 'Cancel')}
          </Button>
          <Button
            id="folder-selector-confirm-btn"
            onClick={handleConfirm}
          >
            {tCommon('confirm', 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
