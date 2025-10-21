'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from 'server/src/components/ui/Dialog';
import { Button } from 'server/src/components/ui/Button';
import { getFolders } from 'server/src/lib/actions/document-actions/documentActions';
import { Folder, Home, ChevronRight } from 'lucide-react';

interface FolderSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder: (folderPath: string | null) => void;
  title?: string;
  description?: string;
}

export default function FolderSelectorModal({
  isOpen,
  onClose,
  onSelectFolder,
  title = "Select Destination Folder",
  description = "Choose where to save this document"
}: FolderSelectorModalProps) {
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [folders, setFolders] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadFolders();
    }
  }, [isOpen]);

  const loadFolders = async () => {
    setLoading(true);
    try {
      const folderList = await getFolders();
      setFolders(folderList);
    } catch (error) {
      console.error('Error loading folders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = () => {
    onSelectFolder(selectedFolder);
    onClose();
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
          className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
            selectedFolder === folder ? 'bg-purple-50 text-purple-700 font-medium border-l-2 border-purple-500' : 'text-gray-700'
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

        <div className="flex-1 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1">
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading folders...</div>
          ) : (
            <>
              {/* Root option */}
              <button
                type="button"
                onClick={() => setSelectedFolder(null)}
                className={`block w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                  selectedFolder === null ? 'bg-purple-50 text-purple-700 font-medium border-l-2 border-purple-500' : 'text-gray-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Home className="w-4 h-4" />
                  <span>Root (No folder)</span>
                </div>
              </button>

              {/* Folder tree */}
              {folders.length > 0 ? (
                renderFolderTree(folders)
              ) : (
                <div className="text-center py-4 text-sm text-gray-500">
                  No folders available. Documents will be saved to root.
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
            Cancel
          </Button>
          <Button
            id="folder-selector-confirm-btn"
            onClick={handleConfirm}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
