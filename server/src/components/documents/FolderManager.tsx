'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { FolderPlus } from 'lucide-react';

interface FolderManagerProps {
  open: boolean;
  onClose: () => void;
  currentFolder: string | null;
  onFolderCreated: (folderPath: string) => void;
}

export default function FolderManager({
  open,
  onClose,
  currentFolder,
  onFolderCreated
}: FolderManagerProps) {
  const [folderName, setFolderName] = useState('');

  function handleCreate() {
    if (!folderName.trim()) return;

    const newPath = currentFolder
      ? `${currentFolder}/${folderName.trim()}`
      : `/${folderName.trim()}`;

    onFolderCreated(newPath);
    setFolderName('');
    onClose();
  }

  return (
    <Dialog isOpen={open} onClose={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create New Folder</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Folder Name</label>
            <Input
              id="folder-name-input"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="Enter folder name"
              onKeyPress={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {currentFolder && (
            <div className="text-sm text-gray-500">
              Will be created in: {currentFolder}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button id="folder-cancel-button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button id="folder-create-button" onClick={handleCreate} disabled={!folderName.trim()}>
              <FolderPlus className="w-4 h-4 mr-2" />
              Create
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
