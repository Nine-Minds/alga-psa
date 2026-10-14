'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { ArrowDown, ArrowUp, MoreVertical } from 'lucide-react';
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

  const load = useCallback(async () => {
    const result = await listAssetStatuses({ includeArchived: true, withUsage: true });
    if (isActionPermissionError(result)) {
      toast.error(getErrorMessage(result));
      return;
    }
    setRows(result);
  }, []);

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

  const reorder = async (status: AssetStatus, direction: -1 | 1) => {
    const ordered = [...rows].sort((a, b) => a.display_order - b.display_order);
    const index = ordered.findIndex((row) => row.status_id === status.status_id);
    const swapWith = ordered[index + direction];
    if (!swapWith) return;

    const results = await Promise.all([
      updateAssetStatus(status.status_id, { display_order: swapWith.display_order }),
      updateAssetStatus(swapWith.status_id, { display_order: status.display_order }),
    ]);
    for (const result of results) {
      if (isActionPermissionError(result)) {
        toast.error(getErrorMessage(result));
        return;
      }
      if (!result.success) {
        toast.error(registryErrorMessage(result.error));
        return;
      }
    }
    await load();
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

  const columns: ColumnDefinition<AssetStatus>[] = [
    {
      title: t('assetStatusSettings.columns.label', { defaultValue: 'Status' }),
      dataIndex: 'label',
      render: (value: string, row) => (
        <span className={row.is_active ? '' : 'text-[rgb(var(--color-text-400))] line-through'}>{value}</span>
      ),
    },
    {
      title: t('assetStatusSettings.columns.kind', { defaultValue: 'Lifecycle' }),
      dataIndex: 'kind',
      render: (value: string) => t(`assetStatusKinds.${value}`, { defaultValue: value }),
    },
    {
      title: t('assetStatusSettings.columns.builtin', { defaultValue: 'Built-in' }),
      dataIndex: 'is_builtin',
      render: (value: boolean) => (value
        ? t('common.states.yes', { defaultValue: 'Yes' })
        : t('common.states.no', { defaultValue: 'No' })),
    },
    {
      title: t('assetStatusSettings.columns.inUse', { defaultValue: 'In use' }),
      dataIndex: 'in_use_count',
      render: (value: number | undefined) => String(value ?? 0),
    },
    {
      title: t('assetStatusSettings.columns.actions', { defaultValue: 'Actions' }),
      dataIndex: 'actions',
      sortable: false,
      width: '14%',
      render: (_value, row) => (
        <div className="flex items-center gap-1">
          <Button
            id={`asset-status-move-up-${row.status_id}`}
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label={t('assetStatusSettings.actions.moveUp', { defaultValue: 'Move up' })}
            onClick={() => void reorder(row, -1)}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            id={`asset-status-move-down-${row.status_id}`}
            variant="ghost"
            className="h-8 w-8 p-0"
            aria-label={t('assetStatusSettings.actions.moveDown', { defaultValue: 'Move down' })}
            onClick={() => void reorder(row, 1)}
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
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
        <DataTable id="asset-statuses-table" data={rows} columns={columns} pagination={false} />
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
