'use client';

import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Circle, GripVertical, Trash2 } from 'lucide-react';

export interface StatusColumnItem {
  id: string;
  name: string;
  isClosed?: boolean;
  color?: string | null;
}

export interface StatusColumnsEditorProps {
  items: StatusColumnItem[];
  /** When false the list renders read-only (inherited scopes). */
  editable?: boolean;
  /** Optimistic/local reorder — called while dragging and on arrow presses. */
  onReorder?: (orderedIds: string[]) => void;
  /** Persist the order — called once on drop / arrow press. */
  onReorderCommit?: (orderedIds: string[]) => void | Promise<void>;
  /** Host opens the confirmation flow; the editor never deletes on its own. */
  onRequestDelete?: (item: StatusColumnItem, index: number) => void;
  canDelete?: (item: StatusColumnItem, index: number) => boolean;
  /** Replaces the plain name cell (template wizard renders a status picker here). */
  renderRowBody?: (item: StatusColumnItem, index: number) => React.ReactNode;
  /** Extra block rendered under a row (template repair controls). */
  renderRowExtra?: (item: StatusColumnItem, index: number) => React.ReactNode;
  showColor?: boolean;
  idPrefix?: string;
  emptyState?: React.ReactNode;
  className?: string;
}

/**
 * Status name plus its "(Closed)" badge with real textual separation, so lists,
 * copy/paste and screen readers all read "Done (Closed)" instead of "DoneClosed".
 */
export function StatusColumnName({
  name,
  isClosed,
  className,
}: {
  name: string;
  isClosed?: boolean;
  className?: string;
}): React.ReactElement {
  const { t } = useTranslation(['features/projects', 'common']);

  if (!isClosed) {
    return <span className={className ?? 'text-sm font-medium'}>{name}</span>;
  }

  return (
    <span className={className ?? 'text-sm font-medium'}>
      {name}{' '}
      <span className="whitespace-nowrap rounded bg-gray-200 px-1.5 py-0.5 align-middle text-xs font-normal text-gray-700 dark:bg-gray-700 dark:text-gray-200">
        {t('settings.statuses.closed_badge', '(Closed)')}
      </span>
    </span>
  );
}

/**
 * Presentational list of task status columns shared by the project editor, the
 * template status manager and the template wizard. Every interactive element is
 * an explicit `type="button"` so the editor is safe to embed inside a form —
 * the project drawer used to submit and close itself on every move/delete click.
 */
export function StatusColumnsEditor({
  items,
  editable = true,
  onReorder,
  onReorderCommit,
  onRequestDelete,
  canDelete,
  renderRowBody,
  renderRowExtra,
  showColor = false,
  idPrefix = 'status-column',
  emptyState,
  className,
}: StatusColumnsEditorProps): React.ReactElement {
  const { t } = useTranslation(['features/projects', 'common']);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const orderAtDragStart = useRef<string | null>(null);

  const moveTo = (from: number, to: number) => {
    if (!editable || to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    const orderedIds = next.map((item) => item.id);
    onReorder?.(orderedIds);
    return orderedIds;
  };

  const handleArrowMove = async (from: number, to: number) => {
    const orderedIds = moveTo(from, to);
    if (orderedIds) {
      await onReorderCommit?.(orderedIds);
    }
  };

  const handleDragOver = (event: React.DragEvent, targetIndex: number) => {
    event.preventDefault();
    if (!editable || draggedIndex === null || draggedIndex === targetIndex) return;
    moveTo(draggedIndex, targetIndex);
    setDraggedIndex(targetIndex);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;
    setDraggedIndex(null);

    // A drag that never moved anything must not write a reorder.
    const orderedIds = items.map((item) => item.id);
    const before = orderAtDragStart.current;
    orderAtDragStart.current = null;
    if (before === orderedIds.join('|')) return;

    await onReorderCommit?.(orderedIds);
  };

  if (items.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  return (
    <div className={className ?? 'space-y-2'} role="list">
      {items.map((item, index) => {
        const deletable = editable && Boolean(onRequestDelete) && (canDelete ? canDelete(item, index) : true);

        return (
          <div
            key={item.id}
            role="listitem"
            draggable={editable}
            onDragStart={() => {
              if (!editable) return;
              orderAtDragStart.current = items.map((entry) => entry.id).join('|');
              setDraggedIndex(index);
            }}
            onDragOver={(event) => handleDragOver(event, index)}
            onDragEnd={editable ? handleDragEnd : undefined}
            className={`rounded-lg border bg-white p-3 dark:bg-[rgb(var(--color-card))] ${
              draggedIndex === index ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                className={`shrink-0 ${editable ? 'cursor-grab' : 'opacity-40'}`}
                aria-hidden="true"
                title={editable ? t('settings.statuses.drag_to_reorder', 'Drag to reorder') : undefined}
              >
                <GripVertical className="h-4 w-4 text-gray-400" />
              </div>

              {/* Arrow buttons stay as the keyboard / assistive-tech path for reordering. */}
              <div className="flex shrink-0 flex-col gap-0.5">
                <button
                  type="button"
                  onClick={() => void handleArrowMove(index, index - 1)}
                  disabled={index === 0 || !editable}
                  className="rounded p-0.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[rgb(var(--color-border-100))]"
                  title={t('settings.statuses.move_up', 'Move up')}
                  aria-label={t('settings.statuses.move_up', 'Move up')}
                  id={`${idPrefix}-move-up-${item.id}`}
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => void handleArrowMove(index, index + 1)}
                  disabled={index === items.length - 1 || !editable}
                  className="rounded p-0.5 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-[rgb(var(--color-border-100))]"
                  title={t('settings.statuses.move_down', 'Move down')}
                  aria-label={t('settings.statuses.move_down', 'Move down')}
                  id={`${idPrefix}-move-down-${item.id}`}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <span className="w-6 shrink-0 text-xs font-medium text-gray-500">{index + 1}.</span>

              {showColor && (
                <Circle
                  className="h-5 w-5 shrink-0"
                  fill={item.color || '#6B7280'}
                  stroke={item.color || '#6B7280'}
                  aria-hidden="true"
                />
              )}

              <div className="min-w-0 flex-1">
                {renderRowBody ? renderRowBody(item, index) : (
                  <StatusColumnName name={item.name} isClosed={item.isClosed} />
                )}
              </div>

              {deletable && (
                <button
                  type="button"
                  onClick={() => onRequestDelete?.(item, index)}
                  className="shrink-0 rounded p-1 text-destructive hover:bg-destructive/15"
                  title={t('settings.statuses.remove', 'Remove status')}
                  aria-label={t('settings.statuses.remove', 'Remove status')}
                  id={`${idPrefix}-delete-${item.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {renderRowExtra?.(item, index)}
          </div>
        );
      })}
    </div>
  );
}

export default StatusColumnsEditor;
