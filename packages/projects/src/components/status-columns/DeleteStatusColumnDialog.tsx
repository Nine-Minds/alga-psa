'use client';

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';

export interface DeleteStatusColumnRequest {
  id: string;
  name: string;
  taskCount: number;
}

export interface DeleteStatusColumnDialogProps {
  request: DeleteStatusColumnRequest | null;
  /** Other columns in the same scope that tasks can be moved into. */
  moveTargets: Array<{ id: string; name: string; isClosed?: boolean }>;
  isDeleting?: boolean;
  onCancel: () => void;
  onConfirm: (moveToId?: string) => void | Promise<void>;
  idPrefix?: string;
}

/**
 * Required confirmation for removing a status column. When the column still
 * holds tasks the dialog refuses to continue until a destination column is
 * picked, so Delete can never silently drop work.
 */
export function DeleteStatusColumnDialog({
  request,
  moveTargets,
  isDeleting = false,
  onCancel,
  onConfirm,
  idPrefix = 'status-column',
}: DeleteStatusColumnDialogProps): React.ReactElement | null {
  const { t } = useTranslation(['features/projects', 'common']);
  const [moveToId, setMoveToId] = useState('');

  useEffect(() => {
    setMoveToId(moveTargets[0]?.id ?? '');
  }, [request?.id, moveTargets.length]);

  if (!request) return null;

  const needsTarget = request.taskCount > 0;
  const blocked = needsTarget && moveTargets.length === 0;

  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title={t('settings.statuses.confirm_delete_title', 'Delete Status')}
      className="max-w-sm"
      id={`${idPrefix}-delete-dialog`}
    >
      <div className="space-y-4 p-4">
        {needsTarget ? (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t('settings.statuses.delete_has_tasks', {
                statusName: request.name,
                count: request.taskCount,
                defaultValue: '"{{statusName}}" has {{count}} task(s). Move them to:',
              })}
            </p>
            {blocked ? (
              <p className="text-sm text-destructive">
                {t(
                  'settings.statuses.delete_no_move_target',
                  'There is no other status column to move these tasks into. Add another column first.'
                )}
              </p>
            ) : (
              <CustomSelect
                value={moveToId}
                onValueChange={setMoveToId}
                options={moveTargets.map((target) => ({
                  value: target.id,
                  label: target.isClosed
                    ? `${target.name} ${t('settings.statuses.closed_badge', '(Closed)')}`
                    : target.name,
                }))}
                id={`${idPrefix}-move-target-select`}
              />
            )}
          </>
        ) : (
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {t('settings.statuses.confirm_delete', {
              statusName: request.name,
              defaultValue: 'Remove "{{statusName}}"?',
            })}
          </p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {t(
            'settings.statuses.delete_scope_help',
            'This removes the column from this scope only. The status stays in your Task Status Library.'
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button
            id={`${idPrefix}-cancel-delete`}
            variant="outline"
            size="sm"
            onClick={onCancel}
            disabled={isDeleting}
          >
            {t('common:actions.cancel', 'Cancel')}
          </Button>
          <Button
            id={`${idPrefix}-confirm-delete`}
            variant="destructive"
            size="sm"
            onClick={() => void onConfirm(needsTarget ? moveToId : undefined)}
            disabled={isDeleting || blocked || (needsTarget && !moveToId)}
          >
            {needsTarget
              ? t('settings.statuses.delete_and_move', { defaultValue: 'Move & Delete' })
              : t('common:actions.delete', 'Delete')}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export default DeleteStatusColumnDialog;
