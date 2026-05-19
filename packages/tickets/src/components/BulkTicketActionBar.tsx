'use client';

import { Button } from '@alga-psa/ui/components/Button';
import { Move, Layers, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BulkTicketActionBarProps {
  count: number;
  showMove: boolean;
  showBundle: boolean;
  onMove: () => void;
  onBundle: () => void;
  onDelete: () => void;
  onClear: () => void;
  idPrefix?: string;
}

export default function BulkTicketActionBar({
  count,
  showMove,
  showBundle,
  onMove,
  onBundle,
  onDelete,
  onClear,
  idPrefix = 'ticket-bulk-action-bar',
}: BulkTicketActionBarProps) {
  const { t } = useTranslation(['features/tickets', 'common']);

  if (count === 0) return null;

  const bundleEnabled = count >= 2;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white dark:bg-[rgb(var(--color-card))] border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-lg px-4 py-2.5">
      <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))] whitespace-nowrap">
        {t('bulk.actionBar.selectedCount', '{{count}} selected', { count })}
      </span>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      {showMove && (
        <Button
          id={`${idPrefix}-move-button`}
          variant="outline"
          size="sm"
          onClick={onMove}
        >
          <Move className="h-4 w-4 mr-1.5" />
          {t('bulk.actionBar.move', 'Move to Board')}
        </Button>
      )}
      {showBundle && (
        <Button
          id={`${idPrefix}-bundle-button`}
          variant="outline"
          size="sm"
          onClick={onBundle}
          disabled={!bundleEnabled}
          title={!bundleEnabled ? t('bulk.actionBar.bundleNeedsTwo', 'Select at least 2 tickets to bundle') : undefined}
        >
          <Layers className="h-4 w-4 mr-1.5" />
          {t('bulk.actionBar.bundle', 'Bundle')}
        </Button>
      )}
      <Button
        id={`${idPrefix}-delete-button`}
        variant="outline"
        size="sm"
        onClick={onDelete}
        className="text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-1.5" />
        {t('bulk.actionBar.delete', 'Delete')}
      </Button>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      <Button
        id={`${idPrefix}-clear-button`}
        variant="ghost"
        size="sm"
        onClick={onClear}
      >
        <X className="h-4 w-4 mr-1.5" />
        {t('bulk.actionBar.clear', 'Clear')}
      </Button>
    </div>
  );
}
