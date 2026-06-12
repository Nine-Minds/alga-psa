'use client';

import { useEffect, useState } from 'react';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { QuickAddTagPicker } from '@alga-psa/tags/components';
import type { PendingTag } from '@alga-psa/types';
import { useTranslation } from 'react-i18next';

interface BulkAddTagsToTasksDialogProps {
  isOpen: boolean;
  onClose: () => void;
  taskCount: number;
  failed: Array<{ taskId: string; message: string; label?: string }>;
  isSubmitting: boolean;
  onConfirm: (tagTexts: string[]) => Promise<void>;
  idPrefix?: string;
}

export default function BulkAddTagsToTasksDialog({
  isOpen,
  onClose,
  taskCount,
  failed,
  isSubmitting,
  onConfirm,
  idPrefix = 'task-bulk-add-tags',
}: BulkAddTagsToTasksDialogProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const [pendingTags, setPendingTags] = useState<PendingTag[]>([]);

  useEffect(() => {
    if (isOpen) setPendingTags([]);
  }, [isOpen]);

  const trimmedTexts = Array.from(
    new Set(pendingTags.map((tag) => tag.tag_text.trim()).filter((text) => text.length > 0)),
  );
  const hasTags = trimmedTexts.length > 0;

  const handleConfirm = async () => {
    if (!hasTags) return;
    await onConfirm(trimmedTexts);
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      id={`${idPrefix}-dialog`}
      title={t('bulk.tags.dialogTitle', 'Add Tags to Selected Tasks')}
      className="max-w-md"
    >
      <DialogContent>
        {failed.length > 0 && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>
              <p className="font-medium">
                {t('bulk.tags.failedHeading', 'Tags could not be added to the following tasks:')}
              </p>
              <ul className="mt-2 space-y-1">
                {failed.map((error) => (
                  <li key={error.taskId}>
                    <span className="font-medium">{error.label ?? error.taskId}</span>: {error.message}
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        <div className="mb-3 text-sm text-gray-600">
          {t(
            'bulk.tags.message',
            'Add one or more tags to {{count}} selected task(s). Tags already on a task are skipped.',
            { count: taskCount },
          )}
        </div>
        <div className="mb-4">
          <QuickAddTagPicker
            id={`${idPrefix}-picker`}
            entityType="project_task"
            pendingTags={pendingTags}
            onPendingTagsChange={setPendingTags}
            placeholder={t('bulk.tags.placeholder', 'Type a tag and press Enter')}
            disabled={isSubmitting}
          />
        </div>
        <div className="flex justify-end space-x-2">
          <Button id={`${idPrefix}-cancel`} variant="ghost" onClick={onClose} disabled={isSubmitting}>
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button id={`${idPrefix}-confirm`} onClick={handleConfirm} disabled={isSubmitting || !hasTags}>
            {isSubmitting
              ? t('bulk.tags.submitting', 'Adding tags...')
              : t('bulk.tags.confirm', {
                  count: taskCount,
                  defaultValue: taskCount === 1 ? 'Add Tags to {{count}} Task' : 'Add Tags to {{count}} Tasks',
                })}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
