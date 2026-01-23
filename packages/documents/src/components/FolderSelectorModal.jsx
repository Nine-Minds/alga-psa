'use client';
import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { getFolders, createFolder } from '../actions/documentActions';
import { Folder, Home, FolderPlus, X } from 'lucide-react';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
export default function FolderSelectorModal({ isOpen, onClose, onSelectFolder, title: titleProp, description: descriptionProp, namespace = 'common' }) {
    const [selectedFolder, setSelectedFolder] = useState(null);
    const [folders, setFolders] = useState([]);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation(namespace);
    const title = titleProp ?? t('documents.folderSelector.defaultTitle', 'Select Destination Folder');
    const description = descriptionProp ?? t('documents.folderSelector.defaultDescription', 'Choose where to save this document');
    // New folder creation state
    const [showNewFolderInput, setShowNewFolderInput] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderParent, setNewFolderParent] = useState(null);
    const [creatingFolder, setCreatingFolder] = useState(false);
    const [error, setError] = useState(null);
    useEffect(() => {
        if (isOpen) {
            loadFolders();
            // Reset new folder state when modal opens
            setShowNewFolderInput(false);
            setNewFolderName('');
            setNewFolderParent(null);
            setError(null);
        }
    }, [isOpen]);
    const loadFolders = async () => {
        setLoading(true);
        try {
            const folderList = await getFolders();
            setFolders(folderList);
        }
        catch (error) {
            console.error('Error loading folders:', error);
        }
        finally {
            setLoading(false);
        }
    };
    const handleConfirm = () => {
        onSelectFolder(selectedFolder);
        onClose();
    };
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) {
            setError(t('documents.folderSelector.errors.nameRequired', 'Please enter a folder name'));
            return;
        }
        // Validate folder name - no slashes allowed
        if (newFolderName.includes('/')) {
            setError(t('documents.folderSelector.errors.invalidCharacters', 'Folder name cannot contain "/"'));
            return;
        }
        setCreatingFolder(true);
        setError(null);
        try {
            // Build the full folder path
            const folderPath = newFolderParent
                ? `${newFolderParent}/${newFolderName.trim()}`
                : `/${newFolderName.trim()}`;
            await createFolder(folderPath);
            // Reload folders to show the new one
            await loadFolders();
            // Reset the new folder form
            setShowNewFolderInput(false);
            setNewFolderName('');
            setNewFolderParent(null);
            // Auto-select the newly created folder
            setSelectedFolder(folderPath);
        }
        catch (err) {
            console.error('Error creating folder:', err);
            setError(err instanceof Error && err.message
                ? err.message
                : t('documents.folderSelector.errors.createFailed', 'Failed to create folder'));
        }
        finally {
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
    const renderFolderTree = (folders) => {
        // Group folders by depth for hierarchical display
        return folders.map((folder) => {
            const depth = folder.split('/').filter(p => p).length - 1;
            const folderName = folder.split('/').filter(p => p).pop() || folder;
            return (<button key={folder} type="button" onClick={() => setSelectedFolder(folder)} className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${selectedFolder === folder ? 'bg-purple-50 text-purple-700 font-medium border-l-2 border-purple-500' : 'text-gray-700'}`} style={{ paddingLeft: `${(depth + 1) * 12 + 12}px` }}>
          <div className="flex items-center gap-2">
            <Folder className="w-4 h-4 flex-shrink-0"/>
            <span className="truncate">{folderName}</span>
            <span className="text-xs text-gray-400 ml-auto">{folder}</span>
          </div>
        </button>);
        });
    };
    return (<Dialog isOpen={isOpen} onClose={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <p className="text-sm text-gray-500">{description}</p>
        </DialogHeader>

        {/* New Folder Creation Section */}
        {showNewFolderInput ? (<div className="border border-purple-200 rounded-md p-4 bg-purple-50 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-900 flex items-center gap-2">
                <FolderPlus className="w-4 h-4 text-purple-600"/>
                {t('documents.folderSelector.createTitle', 'Create New Folder')}
              </h4>
              <button id="cancel-new-folder-btn" type="button" onClick={handleCancelNewFolder} className="text-gray-400 hover:text-gray-600" disabled={creatingFolder}>
                <X className="w-4 h-4"/>
              </button>
            </div>

            <div>
              <label className="block text-sm text-gray-600 mb-1">
                {t('documents.folderSelector.parentLabel', {
                folder: newFolderParent || t('documents.folderSelector.rootLabel', '/ (Root)'),
                defaultValue: `Parent folder: ${newFolderParent || '/ (Root)'}`
            })}
              </label>
            </div>

            <div className="space-y-2">
              <Input id="new-folder-name-input" type="text" placeholder={t('documents.folderSelector.namePlaceholder', 'Enter folder name')} value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)} onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    handleCreateFolder();
                }
                else if (e.key === 'Escape') {
                    handleCancelNewFolder();
                }
            }} disabled={creatingFolder} className="w-full" autoFocus/>
              {error && (<p className="text-sm text-red-600">{error}</p>)}
            </div>

            <div className="flex gap-2 justify-end">
              <Button id="cancel-folder-creation-btn" type="button" variant="outline" size="sm" onClick={handleCancelNewFolder} disabled={creatingFolder}>
                {t('common.cancel', 'Cancel')}
              </Button>
              <Button id="create-folder-btn" type="button" size="sm" onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
                {creatingFolder
                ? t('documents.folderSelector.creating', 'Creating...')
                : t('documents.folderSelector.createButton', 'Create Folder')}
              </Button>
            </div>
          </div>) : (<div className="flex justify-end">
            <Button id="new-folder-btn" type="button" variant="outline" size="sm" onClick={handleStartNewFolder} disabled={loading} className="flex items-center gap-2">
              <FolderPlus className="w-4 h-4"/>
              {t('documents.folderSelector.newFolderButton', 'New Folder')}
            </Button>
          </div>)}

        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1">
          {loading ? (<div className="text-center py-8 text-gray-500">
              {t('documents.folderSelector.loading', 'Loading folders...')}
            </div>) : (<>
              {/* Root option */}
              <button type="button" onClick={() => setSelectedFolder(null)} className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${selectedFolder === null ? 'bg-purple-50 text-purple-700 font-medium border-l-2 border-purple-500' : 'text-gray-700'}`}>
                <div className="flex items-center gap-2">
                  <Home className="w-4 h-4"/>
                  <span>{t('documents.folderSelector.rootOption', 'Root (No folder)')}</span>
                </div>
              </button>

              {/* Folder tree */}
              {folders.length > 0 ? (renderFolderTree(folders)) : (<div className="text-center py-4 text-sm text-gray-500">
                  {t('documents.folderSelector.empty', 'No folders available. Documents will be saved to root.')}
                </div>)}
            </>)}
        </div>

        <DialogFooter>
          <Button id="folder-selector-cancel-btn" variant="outline" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button id="folder-selector-confirm-btn" onClick={handleConfirm}>
            {t('common.confirm', 'Confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>);
}
//# sourceMappingURL=FolderSelectorModal.jsx.map