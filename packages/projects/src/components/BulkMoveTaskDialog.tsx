'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import TreeSelect, { TreeSelectOption, TreeSelectPath } from '@alga-psa/ui/components/TreeSelect';
import { toast } from 'react-hot-toast';
import { useTranslation } from 'react-i18next';

interface BulkMoveTaskDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskCount: number;
  projectTreeData: Array<TreeSelectOption<'project' | 'phase' | 'status'>>;
  onConfirm: (targetPhaseId: string, targetStatusId: string | undefined) => Promise<void>;
}

export default function BulkMoveTaskDialog({
  isOpen,
  onClose,
  taskCount,
  projectTreeData,
  onConfirm,
}: BulkMoveTaskDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [selectedTargetPath, setSelectedTargetPath] = useState<TreeSelectPath | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelectedTargetPath(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleTreeSelect = (_value: string, _type: string, _excluded: boolean, path?: TreeSelectPath) => {
    if (path && path['phase']) {
      setSelectedTargetPath(path);
    } else {
      setSelectedTargetPath(null);
    }
  };

  const handleConfirm = async () => {
    if (!selectedTargetPath || !selectedTargetPath['phase']) {
      toast.error(t('dialogs.moveTask.selectTargetError', 'Please select a target phase.'));
      return;
    }

    const targetPhaseId = selectedTargetPath['phase'];
    const targetStatusId = selectedTargetPath['status'] || undefined;

    setIsSubmitting(true);
    try {
      await onConfirm(targetPhaseId, targetStatusId);
    } catch (error) {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t('dialogs.bulkMoveTask.title', 'Move Tasks')}
      className="max-w-lg max-h-[90vh] overflow-y-auto"
    >
      <DialogContent>
        <div className="mb-2 text-sm text-gray-600">
          {t('dialogs.bulkMoveTask.message', 'Move {{count}} selected task(s) to a new phase/status:', {
            count: taskCount,
          })}
        </div>

        <div className="mb-6">
          <TreeSelect<'project' | 'phase' | 'status'>
            value={selectedTargetPath?.['status'] || selectedTargetPath?.['phase'] || ''}
            onValueChange={handleTreeSelect}
            options={projectTreeData}
            placeholder={t('dialogs.moveTask.placeholder', 'Select target project/phase/status...')}
            className="w-full"
            multiSelect={false}
            showExclude={false}
            showReset={false}
            allowEmpty={false}
          />
        </div>

        <div className="flex justify-end space-x-2">
          <Button id="cancel-bulk-move-button" variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button
            id="confirm-bulk-move-button"
            onClick={handleConfirm}
            disabled={!selectedTargetPath?.['phase'] || isSubmitting}
          >
            {isSubmitting
              ? t('dialogs.moveTask.moving', 'Moving...')
              : t('dialogs.bulkMoveTask.confirm', 'Move Tasks')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
