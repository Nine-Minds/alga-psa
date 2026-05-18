'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { Move, UserPlus, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskSelection } from './TaskSelectionContext';

interface BulkTaskActionBarProps {
  onMove: () => void;
  onAssign: () => void;
  onDelete: () => void;
}

export default function BulkTaskActionBar({ onMove, onAssign, onDelete }: BulkTaskActionBarProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { selectedTaskIds, clearSelection } = useTaskSelection();
  const count = selectedTaskIds.size;

  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white dark:bg-[rgb(var(--color-card))] border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-lg px-4 py-2.5">
      <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))] whitespace-nowrap">
        {t('bulkActions.selectedCount', '{{count}} selected', { count })}
      </span>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      <Button id="bulk-move-tasks-button" variant="outline" size="sm" onClick={onMove}>
        <Move className="h-4 w-4 mr-1.5" />
        {t('bulkActions.move', 'Move')}
      </Button>
      <Button id="bulk-assign-tasks-button" variant="outline" size="sm" onClick={onAssign}>
        <UserPlus className="h-4 w-4 mr-1.5" />
        {t('bulkActions.assign', 'Assign')}
      </Button>
      <Button
        id="bulk-delete-tasks-button"
        variant="outline"
        size="sm"
        onClick={onDelete}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-1.5" />
        {t('bulkActions.delete', 'Delete')}
      </Button>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      <Button id="bulk-clear-selection-button" variant="ghost" size="sm" onClick={clearSelection}>
        <X className="h-4 w-4 mr-1.5" />
        {t('bulkActions.clear', 'Clear')}
      </Button>
    </div>
  );
}
