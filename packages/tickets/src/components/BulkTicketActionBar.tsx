'use client';

import { Button } from '@alga-psa/ui/components/Button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  Move,
  Layers,
  Trash2,
  X,
  UserPlus,
  CircleDot,
  Flag,
  Tag,
  CalendarClock,
  MoreHorizontal,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface BulkTicketActionBarProps {
  count: number;
  showMove: boolean;
  showBundle: boolean;
  showAssign: boolean;
  showStatus: boolean;
  showPriority: boolean;
  showTags: boolean;
  showDueDate: boolean;
  statusDisabled?: boolean;
  statusDisabledTitle?: string;
  onMove: () => void;
  onBundle: () => void;
  onAssign: () => void;
  onStatus: () => void;
  onPriority: () => void;
  onTags: () => void;
  onDueDate: () => void;
  onDelete: () => void;
  onClear: () => void;
  idPrefix?: string;
}

export default function BulkTicketActionBar({
  count,
  showMove,
  showBundle,
  showAssign,
  showStatus,
  showPriority,
  showTags,
  showDueDate,
  statusDisabled = false,
  statusDisabledTitle,
  onMove,
  onBundle,
  onAssign,
  onStatus,
  onPriority,
  onTags,
  onDueDate,
  onDelete,
  onClear,
  idPrefix = 'ticket-bulk-action-bar',
}: BulkTicketActionBarProps) {
  const { t } = useTranslation(['features/tickets', 'common']);

  if (count === 0) return null;

  const bundleEnabled = count >= 2;
  const hasMoreActions = showStatus || showPriority || showTags || showDueDate;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-white dark:bg-[rgb(var(--color-card))] border border-gray-200 dark:border-[rgb(var(--color-border-200))] rounded-lg shadow-lg px-4 py-2.5">
      <span className="text-sm font-medium text-gray-700 dark:text-[rgb(var(--color-text-200))] whitespace-nowrap">
        {t('bulk.actionBar.selectedCount', '{{count}} selected', { count })}
      </span>
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      {showAssign && (
        <Button
          id={`${idPrefix}-assign-button`}
          variant="outline"
          size="sm"
          onClick={onAssign}
          className="whitespace-nowrap"
        >
          <UserPlus className="h-4 w-4 mr-1.5" />
          {t('bulk.actionBar.assign', 'Assign')}
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
          className="whitespace-nowrap"
        >
          <Layers className="h-4 w-4 mr-1.5" />
          {t('bulk.actionBar.bundle', 'Bundle')}
        </Button>
      )}
      {showMove && (
        <Button
          id={`${idPrefix}-move-button`}
          variant="outline"
          size="sm"
          onClick={onMove}
          className="whitespace-nowrap"
        >
          <Move className="h-4 w-4 mr-1.5" />
          {t('bulk.actionBar.move', 'Move to Board')}
        </Button>
      )}
      <Button
        id={`${idPrefix}-delete-button`}
        variant="outline"
        size="sm"
        onClick={onDelete}
        className="whitespace-nowrap text-destructive hover:text-destructive"
      >
        <Trash2 className="h-4 w-4 mr-1.5" />
        {t('bulk.actionBar.delete', 'Delete')}
      </Button>
      {hasMoreActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`${idPrefix}-more-button`}
              variant="outline"
              size="sm"
              className="whitespace-nowrap"
            >
              <MoreHorizontal className="h-4 w-4 mr-1.5" />
              {t('bulk.actionBar.more', 'More')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[10rem]">
            {showStatus && (
              <DropdownMenuItem
                id={`${idPrefix}-status-menu-item`}
                disabled={statusDisabled}
                onSelect={() => {
                  if (statusDisabled) return;
                  onStatus();
                }}
                title={statusDisabled ? statusDisabledTitle : undefined}
              >
                <CircleDot className="h-4 w-4 mr-2" />
                {t('bulk.actionBar.status', 'Status')}
              </DropdownMenuItem>
            )}
            {showPriority && (
              <DropdownMenuItem
                id={`${idPrefix}-priority-menu-item`}
                onSelect={onPriority}
              >
                <Flag className="h-4 w-4 mr-2" />
                {t('bulk.actionBar.priority', 'Priority')}
              </DropdownMenuItem>
            )}
            {showTags && (
              <DropdownMenuItem
                id={`${idPrefix}-tags-menu-item`}
                onSelect={onTags}
              >
                <Tag className="h-4 w-4 mr-2" />
                {t('bulk.actionBar.tags', 'Tags')}
              </DropdownMenuItem>
            )}
            {showDueDate && (
              <DropdownMenuItem
                id={`${idPrefix}-due-date-menu-item`}
                onSelect={onDueDate}
              >
                <CalendarClock className="h-4 w-4 mr-2" />
                {t('bulk.actionBar.dueDate', 'Due Date')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <div className="h-5 w-px bg-gray-200 dark:bg-[rgb(var(--color-border-200))]" />
      <Button
        id={`${idPrefix}-clear-button`}
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="whitespace-nowrap"
      >
        <X className="h-4 w-4 mr-1.5" />
        {t('bulk.actionBar.clear', 'Clear')}
      </Button>
    </div>
  );
}
