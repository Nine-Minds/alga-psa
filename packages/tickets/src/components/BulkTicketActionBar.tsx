'use client';

import { BulkActionBar, type BulkActionBarAction } from '@alga-psa/ui/components/BulkActionBar';
import {
  Move,
  Layers,
  Trash2,
  UserPlus,
  CircleDot,
  Flag,
  Tag,
  CalendarClock,
  Printer,
} from 'lucide-react';
import { MAX_LABELS_PER_REQUEST } from '@alga-psa/types';
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
  onPrintLabels: () => void;
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
  onPrintLabels,
  onClear,
  idPrefix = 'ticket-bulk-action-bar',
}: BulkTicketActionBarProps) {
  const { t } = useTranslation(['features/tickets', 'common']);

  const bundleEnabled = count >= 1;

  const actions: BulkActionBarAction[] = [];
  if (showAssign) {
    actions.push({
      id: 'assign',
      label: t('bulk.actionBar.assign', 'Assign'),
      icon: <UserPlus className="h-4 w-4" />,
      onClick: onAssign,
    });
  }
  if (showBundle) {
    actions.push({
      id: 'bundle',
      label: t('bulk.actionBar.bundle', 'Bundle'),
      icon: <Layers className="h-4 w-4" />,
      onClick: onBundle,
      disabled: !bundleEnabled,
      title: !bundleEnabled
        ? t('bulk.actionBar.bundleNeedsOne', 'Select at least 1 ticket to bundle')
        : undefined,
    });
  }
  if (showMove) {
    actions.push({
      id: 'move',
      label: t('bulk.actionBar.move', 'Move to Board'),
      icon: <Move className="h-4 w-4" />,
      onClick: onMove,
    });
  }
  const printTooMany = count > MAX_LABELS_PER_REQUEST;
  actions.push({
    id: 'print-labels',
    label: t('bulk.actionBar.printLabels', 'Print labels'),
    icon: <Printer className="h-4 w-4" />,
    onClick: onPrintLabels,
    disabled: printTooMany,
    title: printTooMany
      ? t('bulk.actionBar.printLabelsLimit', 'You can print at most {{max}} labels at a time', { max: MAX_LABELS_PER_REQUEST })
      : undefined,
  });
  actions.push({
    id: 'delete',
    label: t('bulk.actionBar.delete', 'Delete'),
    icon: <Trash2 className="h-4 w-4" />,
    onClick: onDelete,
    destructive: true,
  });

  const overflowActions: BulkActionBarAction[] = [];
  if (showStatus) {
    overflowActions.push({
      id: 'status',
      label: t('bulk.actionBar.status', 'Status'),
      icon: <CircleDot className="h-4 w-4" />,
      onClick: onStatus,
      disabled: statusDisabled,
      title: statusDisabled ? statusDisabledTitle : undefined,
    });
  }
  if (showPriority) {
    overflowActions.push({
      id: 'priority',
      label: t('bulk.actionBar.priority', 'Priority'),
      icon: <Flag className="h-4 w-4" />,
      onClick: onPriority,
    });
  }
  if (showTags) {
    overflowActions.push({
      id: 'tags',
      label: t('bulk.actionBar.tags', 'Tags'),
      icon: <Tag className="h-4 w-4" />,
      onClick: onTags,
    });
  }
  if (showDueDate) {
    overflowActions.push({
      id: 'due-date',
      label: t('bulk.actionBar.dueDate', 'Due Date'),
      icon: <CalendarClock className="h-4 w-4" />,
      onClick: onDueDate,
    });
  }

  return (
    <BulkActionBar
      idPrefix={idPrefix}
      count={count}
      selectedLabel={t('bulk.actionBar.selectedCount', '{{count}} selected', { count })}
      actions={actions}
      overflowActions={overflowActions}
      overflowLabel={t('bulk.actionBar.more', 'More')}
      onClear={onClear}
      clearLabel={t('bulk.actionBar.clear', 'Clear')}
    />
  );
}
