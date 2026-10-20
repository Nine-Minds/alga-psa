'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { toast } from 'react-hot-toast';
import { GripVertical, MoreVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { isActionPermissionError, getErrorMessage } from '@alga-psa/ui/lib/errorHandling';
import type { AssetStatus, AssetStatusKind, ColumnDefinition } from '@alga-psa/types';
import {
  archiveAssetStatus,
  createAssetStatus,
  listAssetStatuses,
  reorderAssetStatuses,
  restoreAssetStatus,
  updateAssetStatus,
} from '../../actions/assetStatusActions';
import { ASSET_STATUS_KINDS, type AssetStatusRegistryError } from '../../lib/assetStatusSchema';

/**
 * Settings → Assets → Statuses (FR-B4). Statuses are archived, never deleted,
 * and archiving is refused while assets still use the slug — the refusal
 * carries the count so the operator knows how much work is left.
 */
export default function AssetStatusesManager() {
  const { t } = useTranslation('msp/assets');
  const [rows, setRows] = useState<AssetStatus[]>([]);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AssetStatus | null>(null);
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<AssetStatusKind>('deployable');
  const [archiving, setArchiving] = useState<AssetStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // The registry speaks in codes; the operator reads their own language. A
  // raw server string ("2 asset(s) still use …") was reaching the toast.
  const registryErrorMessage = useCallback((error: AssetStatusRegistryError): string => {
    switch (error.code) {
      case 'status_in_use':
        return t('assetStatusSettings.errors.inUse', {
          defaultValue: 'Still used by {{count}} asset(s). Move them to another status first.',
          count: error.inUseCount ?? 0,
        });
      case 'duplicate_slug':
        return t('assetStatusSettings.errors.duplicate', {
          defaultValue: 'A status with that name already exists.',
        });
      case 'invalid_kind':
        return t('assetStatusSettings.errors.invalidKind', {
          defaultValue: 'Choose a lifecycle for this status.',
        });
      case 'invalid_status':
        return t('assetStatusSettings.errors.invalidLabel', {
          defaultValue: 'Enter a name with at least one letter or digit.',
        });
      case 'not_found':
        return t('assetStatusSettings.errors.notFound', {
          defaultValue: 'That status no longer exists. Refresh and try again.',
        });
      default:
        return t('assetStatusSettings.errors.save', { defaultValue: 'Unable to save the status.' });
    }
  }, [t]);

  const kindOptions = useMemo(() => ASSET_STATUS_KINDS.map((value) => ({
    value,
    label: t(`assetStatusKinds.${value}`, { defaultValue: value }),
  })), [t]);

  /**
   * A drag fires many `dragover` events between renders, so the live order is
   * kept in a ref: reading it from state would let two events compute the same
   * move twice. The ref is written wherever rows are set, never synced from
   * state in an effect — a passive effect lands a tick after the commit, and a
   * drag or arrow key arriving in that gap would read a stale order.
   */
  const orderRef = useRef<AssetStatus[]>([]);
  const replaceRows = useCallback((next: AssetStatus[]) => {
    orderRef.current = next;
    setRows(next);
  }, []);

  const load = useCallback(async () => {
    const result = await listAssetStatuses({ includeArchived: true, withUsage: true });
    if (isActionPermissionError(result)) {
      toast.error(getErrorMessage(result));
      return;
    }
    replaceRows(result);
  }, [replaceRows]);

  useEffect(() => {
    void load().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('assetStatusSettings.errors.load', { defaultValue: 'Unable to load asset statuses' }));
    });
  }, [load, t]);

  const openEditor = (status?: AssetStatus) => {
    setEditing(status ?? null);
    setLabel(status?.label ?? '');
    setKind(status?.kind ?? 'deployable');
    setIsEditorOpen(true);
  };

  const save = async () => {
    setIsSaving(true);
    try {
      const result = editing
        ? await updateAssetStatus(editing.status_id, { label, kind })
        : await createAssetStatus({ label, kind });

      if (isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(registryErrorMessage(result.error));
        return;
      }
      setIsEditorOpen(false);
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * The table renders `rows` in order and the server stores that order as
   * `display_order`, which every status select reads — so the list is dragged,
   * not nudged. The move lands locally first and is written on drop; a refusal
   * reloads, putting the server's order back on screen.
   */
  const commitOrder = useCallback(async (ordered: AssetStatus[]) => {
    const result = await reorderAssetStatuses(ordered.map((row) => row.status_id));
    if (isActionPermissionError(result)) {
      toast.error(getErrorMessage(result));
      await load();
      return;
    }
    if (!result.success) {
      toast.error(registryErrorMessage(result.error));
      await load();
      return;
    }
    // Reload rather than trust the returned rows: this table also shows the
    // in-use count, which the reorder does not recompute.
    await load();
  }, [load, registryErrorMessage]);

  const moveRow = useCallback((fromIndex: number, toIndex: number): AssetStatus[] | null => {
    const current = orderRef.current;
    if (fromIndex === toIndex) return null;
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) return null;
    const next = [...current];
    const [row] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, row);
    replaceRows(next);
    return next;
  }, [replaceRows]);

  const dragRef = useRef<{ statusId: string; orderAtStart: string } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const handleDragStart = (status: AssetStatus) => {
    dragRef.current = {
      statusId: status.status_id,
      orderAtStart: orderRef.current.map((row) => row.status_id).join('|'),
    };
    setDraggingId(status.status_id);
  };

  const handleDragOverRow = (event: DragEvent<HTMLTableRowElement>, index: number) => {
    const drag = dragRef.current;
    if (!drag) return;
    event.preventDefault();
    const from = orderRef.current.findIndex((row) => row.status_id === drag.statusId);
    if (from === -1 || from === index) return;
    moveRow(from, index);
  };

  const handleDragEnd = async () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDraggingId(null);
    if (!drag) return;
    const ordered = orderRef.current;
    // A drag that ended where it started must not write anything.
    if (ordered.map((row) => row.status_id).join('|') === drag.orderAtStart) return;
    await commitOrder(ordered);
  };

  /**
   * The table keys its rows by position, so the grip that was focused keeps its
   * place in the DOM and belongs to whichever status landed there — a second
   * arrow press would move that one and undo the first. Focus follows the row
   * that actually moved, found by its own id once React has re-rendered.
   */
  const focusDragHandle = useCallback((statusId: string) => {
    if (typeof window === 'undefined') return;
    const apply = () => {
      const active = document.activeElement as HTMLElement | null;
      // Only chase focus while it is still on the grips.
      if (active?.id && !active.id.startsWith('asset-status-drag-handle-')) return;
      document.getElementById(`asset-status-drag-handle-${statusId}`)?.focus();
    };
    if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(apply);
    else setTimeout(apply, 0);
  }, []);

  /** Keyboard path for the same move, since a grip cannot be dragged by key. */
  const moveByKeyboard = async (index: number, direction: -1 | 1) => {
    const statusId = orderRef.current[index]?.status_id;
    const next = moveRow(index, index + direction);
    if (!next || !statusId) return;
    focusDragHandle(statusId);
    await commitOrder(next);
    focusDragHandle(statusId);
  };

  const confirmArchive = async () => {
    if (!archiving) return;
    setIsSaving(true);
    try {
      const result = await archiveAssetStatus(archiving.status_id);
      if (isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        setArchiving(null);
        return;
      }
      if (!result.success) {
        // A refusal is final — leaving the dialog open invited the operator to
        // press Archive again and watch it fail again.
        toast.error(registryErrorMessage(result.error));
        setArchiving(null);
        await load();
        return;
      }
      setArchiving(null);
      await load();
    } finally {
      setIsSaving(false);
    }
  };

  const restore = async (status: AssetStatus) => {
    const result = await restoreAssetStatus(status.status_id);
    if (isActionPermissionError(result)) {
      toast.error(getErrorMessage(result));
      return;
    }
    if (!result.success) {
      toast.error(registryErrorMessage(result.error));
      return;
    }
    await load();
  };

  // Sorting is off on every column on purpose: the order IS the data here, and
  // a sorted view would have the operator drag rows into an order the server
  // could not store.
  const columns: ColumnDefinition<AssetStatus>[] = [
    {
      title: '',
      dataIndex: 'display_order',
      id: 'drag_handle',
      sortable: false,
      width: '44px',
      render: (_value, row, index) => (
        <button
          id={`asset-status-drag-handle-${row.status_id}`}
          type="button"
          title={t('assetStatusSettings.actions.dragToReorder', { defaultValue: 'Drag to reorder' })}
          onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
            if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
            event.preventDefault();
            void moveByKeyboard(index, event.key === 'ArrowUp' ? -1 : 1);
          }}
          aria-label={t('assetStatusSettings.actions.reorder', {
            defaultValue: 'Reorder {{label}} — drag, or press the up and down arrow keys',
            label: row.label,
          })}
          className="cursor-grab rounded p-1 text-[rgb(var(--color-text-400))] hover:bg-[rgb(var(--color-border-100))] hover:text-[rgb(var(--color-text-600))] active:cursor-grabbing"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      ),
    },
    {
      title: t('assetStatusSettings.columns.label', { defaultValue: 'Status' }),
      dataIndex: 'label',
      sortable: false,
      render: (value: string, row) => (
        <span className={row.is_active ? '' : 'text-[rgb(var(--color-text-400))] line-through'}>{value}</span>
      ),
    },
    {
      title: t('assetStatusSettings.columns.kind', { defaultValue: 'Lifecycle' }),
      dataIndex: 'kind',
      sortable: false,
      render: (value: string) => t(`assetStatusKinds.${value}`, { defaultValue: value }),
    },
    {
      title: t('assetStatusSettings.columns.builtin', { defaultValue: 'Built-in' }),
      dataIndex: 'is_builtin',
      sortable: false,
      render: (value: boolean) => (value
        ? t('common.states.yes', { defaultValue: 'Yes' })
        : t('common.states.no', { defaultValue: 'No' })),
    },
    {
      title: t('assetStatusSettings.columns.inUse', { defaultValue: 'In use' }),
      dataIndex: 'in_use_count',
      sortable: false,
      render: (value: number | undefined) => String(value ?? 0),
    },
    {
      title: t('assetStatusSettings.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      sortable: false,
      width: '14%',
      render: (_value, row) => (
        <div className="flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button id={`asset-status-actions-menu-${row.status_id}`} variant="ghost" className="h-8 w-8 p-0">
                <span className="sr-only">{t('assetStatusSettings.actions.openMenu', { defaultValue: 'Open menu' })}</span>
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem id={`asset-status-rename-${row.status_id}`} onClick={() => openEditor(row)}>
                {t('assetStatusSettings.actions.rename', { defaultValue: 'Rename' })}
              </DropdownMenuItem>
              {row.is_active ? (
                // FR-B4: the server refuses to archive a status assets still
                // carry, so the menu says so up front instead of offering an
                // action that always fails.
                <DropdownMenuItem
                  id={`asset-status-archive-${row.status_id}`}
                  disabled={(row.in_use_count ?? 0) > 0}
                  onClick={() => setArchiving(row)}
                >
                  {(row.in_use_count ?? 0) > 0
                    ? t('assetStatusSettings.actions.archiveBlocked', {
                        defaultValue: 'Archive · {{count}} asset(s) still on it',
                        count: row.in_use_count ?? 0,
                      })
                    : t('assetStatusSettings.actions.archive', { defaultValue: 'Archive' })}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  id={`asset-status-restore-${row.status_id}`}
                  onClick={() => void restore(row)}
                >
                  {t('assetStatusSettings.actions.restore', { defaultValue: 'Restore' })}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ),
    },
  ];

  return (
    <section id="asset-statuses-settings" className="mt-6 rounded-lg border border-[rgb(var(--color-border-200))] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            {t('assetStatusSettings.title', { defaultValue: 'Asset statuses' })}
          </h2>
          <p className="text-sm text-[rgb(var(--color-text-500))]">
            {t('assetStatusSettings.description', {
              defaultValue: 'The lifecycle states assets can be in. RMM sync never overwrites them after a device is created.',
            })}
          </p>
        </div>
        <Button id="asset-status-add" onClick={() => openEditor()}>
          {t('assetStatusSettings.actions.add', { defaultValue: 'Add status' })}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">
          {t('assetStatusSettings.empty', { defaultValue: 'No asset statuses yet.' })}
        </p>
      ) : (
        <DataTable
          id="asset-statuses-table"
          data={rows}
          columns={columns}
          pagination={false}
          rowClassName={(row) => (row.status_id === draggingId ? 'opacity-50' : '')}
          rowProps={(row, index) => ({
            draggable: true,
            onDragStart: () => handleDragStart(row),
            onDragOver: (event: DragEvent<HTMLTableRowElement>) => handleDragOverRow(event, index),
            onDrop: (event: DragEvent<HTMLTableRowElement>) => event.preventDefault(),
            onDragEnd: () => void handleDragEnd(),
          })}
        />
      )}

      <Dialog
        id="asset-status-editor"
        isOpen={isEditorOpen}
        onClose={() => setIsEditorOpen(false)}
        title={editing
          ? t('assetStatusSettings.editTitle', { defaultValue: 'Edit status' })
          : t('assetStatusSettings.addTitle', { defaultValue: 'Add status' })}
        className="max-w-lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="asset-status-cancel" variant="secondary" onClick={() => setIsEditorOpen(false)}>
              {t('common.actions.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button id="asset-status-save" disabled={isSaving || !label.trim()} onClick={() => void save()}>
              {t('common.actions.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="asset-status-label-input">
              {t('assetStatusSettings.fields.label', { defaultValue: 'Label' })}
              <Input
                id="asset-status-label-input"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <div>
              <label className="block text-sm font-medium" htmlFor="asset-status-kind-select">
                {t('assetStatusSettings.fields.kind', { defaultValue: 'Lifecycle' })}
              </label>
              <CustomSelect
                id="asset-status-kind-select"
                value={kind}
                onValueChange={(value) => setKind(value as AssetStatusKind)}
                options={kindOptions}
                className="mt-1"
              />
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="asset-status-confirm-archive-dialog"
        isOpen={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
        title={t('assetStatusSettings.confirmArchiveTitle', { defaultValue: 'Archive this status?' })}
        message={t('assetStatusSettings.confirmArchiveMessage', {
          defaultValue: 'Archive "{{label}}"? It stops being offered on every asset form. You can restore it later.',
          label: archiving?.label ?? '',
        })}
        confirmLabel={t('assetStatusSettings.actions.archive', { defaultValue: 'Archive' })}
        cancelLabel={t('common.actions.cancel', { defaultValue: 'Cancel' })}
        isConfirming={isSaving}
      />
    </section>
  );
}
