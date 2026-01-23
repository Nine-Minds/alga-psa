'use client';

import React, { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { FolderPlus } from 'lucide-react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';

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
  const { t } = useTranslation('common');

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
          <DialogTitle>{t('documents.folderManager.title', 'Create New Folder')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">{t('documents.folderManager.nameLabel', 'Folder Name')}</label>
            <Input
              id="folder-name-input"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder={t('documents.folderManager.namePlaceholder', 'Enter folder name')}
              onKeyPress={(e) => e.key === 'Enter' && handleCreate()}
            />
          </div>

          {currentFolder && (
            <div className="text-sm text-gray-500">
              {t('documents.folderManager.willCreateIn', {
                folder: currentFolder,
                defaultValue: `Will be created in: ${currentFolder}`
              })}
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button id="folder-cancel-button" variant="outline" onClick={onClose}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="folder-create-button" onClick={handleCreate} disabled={!folderName.trim()}>
              <FolderPlus className="w-4 h-4 mr-2" />
              {t('common.create', 'Create')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
