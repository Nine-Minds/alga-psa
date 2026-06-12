'use client';

import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import { Move, Tag, UserPlus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTaskSelection } from './TaskSelectionContext';

interface BulkTaskActionBarProps {
  onMove: () => void;
  onAssign: () => void;
  onTags: () => void;
  onDelete: () => void;
}

export default function BulkTaskActionBar({ onMove, onAssign, onTags, onDelete }: BulkTaskActionBarProps) {
  const { t } = useTranslation(['features/projects', 'common']);
  const { selectedTaskIds, clearSelection } = useTaskSelection();
  const count = selectedTaskIds.size;

  return (
    <BulkActionBar
      idPrefix="bulk-tasks"
      count={count}
      selectedLabel={t('bulkActions.selectedCount', '{{count}} selected', { count })}
      actions={[
        {
          id: 'move',
          label: t('bulkActions.move', 'Move'),
          icon: <Move className="h-4 w-4" />,
          onClick: onMove,
        },
        {
          id: 'assign',
          label: t('bulkActions.assign', 'Assign'),
          icon: <UserPlus className="h-4 w-4" />,
          onClick: onAssign,
        },
        {
          id: 'tags',
          label: t('bulkActions.tags', 'Tags'),
          icon: <Tag className="h-4 w-4" />,
          onClick: onTags,
        },
        {
          id: 'delete',
          label: t('bulkActions.delete', 'Delete'),
          icon: <Trash2 className="h-4 w-4" />,
          onClick: onDelete,
          destructive: true,
        },
      ]}
      onClear={clearSelection}
      clearLabel={t('bulkActions.clear', 'Clear')}
    />
  );
}
