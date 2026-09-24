'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { MoreVertical, Trash2 } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { BulkActionBar } from '@alga-psa/ui/components/BulkActionBar';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@alga-psa/ui/components/DropdownMenu';
import { useRangeSelection } from '@alga-psa/ui/hooks';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { AssetRemoteAccessLink } from '@alga-psa/types';
import { assetActionErrorMessage, isAssetActionError, unwrapAssetActionResult } from '../../actions/assetActionErrors';
import { deleteRemoteAccessLink, deleteRemoteAccessLinks, listRemoteAccessLinks, saveRemoteAccessLink } from '../../actions/remoteAccessLinkActions';
import type { ColumnDefinition } from '@alga-psa/types';

export default function RemoteAccessLinksManager() {
  const { t } = useTranslation('msp/assets');
  const [rows, setRows] = useState<AssetRemoteAccessLink[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<AssetRemoteAccessLink | null>(null);
  const [label, setLabel] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('');
  const [deleting, setDeleting] = useState<AssetRemoteAccessLink | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selection = useRangeSelection({ items: rows, getId: (row) => row.link_id, selectedIds: selectedSet, onSelectedIdsChange: (next) => setSelectedIds([...next]) });

  const loadLinks = useCallback(async () => {
    const nextRows = unwrapAssetActionResult(await listRemoteAccessLinks());
    setRows(nextRows);
    const availableIds = new Set(nextRows.map((row) => row.link_id));
    setSelectedIds((current) => current.filter((id) => availableIds.has(id)));
  }, []);

  useEffect(() => {
    void loadLinks().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.load'));
    });
  }, [loadLinks, t]);

  const actionErrorToast = (error: unknown, fallback: string) => {
    const key = (error as { messageKey?: string }).messageKey;
    return key ? t(key.replace('msp/assets:', '')) : assetActionErrorMessage(error) || fallback;
  };

  const openEditor = (link?: AssetRemoteAccessLink) => {
    setEditing(link ?? null);
    setLabel(link?.label ?? '');
    setUrlTemplate(link?.url_template ?? '');
    setIsOpen(true);
  };

  const save = async () => {
    try {
      const result = await saveRemoteAccessLink({
        link_id: editing?.link_id,
        label,
        url_template: urlTemplate,
      });
      if (isAssetActionError(result)) {
        toast.error(actionErrorToast(result, t('remoteAccess.links.errors.save')));
        return;
      }
      setIsOpen(false);
      await loadLinks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.save'));
    }
  };

  const confirmBulkRemove = async () => {
    setIsDeleting(true);
    try {
      const result = await deleteRemoteAccessLinks(selectedIds);
      if (isAssetActionError(result)) { toast.error(actionErrorToast(result, t('remoteAccess.links.errors.delete'))); return; }
      setConfirmBulkDelete(false); setSelectedIds([]);
      if (result.failedIds.length) toast.error(t('remoteAccess.links.errors.partialDelete', { count: result.failedIds.length }));
      await loadLinks();
    } catch (error) { toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.delete')); }
    finally { setIsDeleting(false); }
  };

  const allSelected = rows.length > 0 && rows.every((row) => selectedSet.has(row.link_id));
  const columns: ColumnDefinition<AssetRemoteAccessLink>[] = [
    { title: <Checkbox id="remote-access-links-select-all" aria-label={t('remoteAccess.links.selectAll', { defaultValue: 'Select all links' })} checked={allSelected} indeterminate={selectedIds.length > 0 && !allSelected} onChange={(event) => setSelectedIds(event.target.checked ? rows.map((row) => row.link_id) : [])} />, dataIndex: 'selection', sortable: false, width: '5%', render: (_value, row) => <Checkbox id={`remote-access-link-select-${row.link_id}`} checked={selection.isSelected(row.link_id)} aria-label={row.label} onClick={(event) => event.stopPropagation()} onChange={(event) => selection.handleSelect(row.link_id, { selected: event.target.checked })} /> },
    { title: t('remoteAccess.links.label'), dataIndex: 'label' },
    { title: t('remoteAccess.links.template'), dataIndex: 'url_template', render: (value: string) => <span className="block max-w-xl truncate" title={value}>{value}</span> },
    { title: t('remoteAccess.links.actions', { defaultValue: 'Actions' }), dataIndex: 'actions', sortable: false, width: '8%', render: (_value, row) => <DropdownMenu><DropdownMenuTrigger asChild><Button id="remote-access-link-actions-menu" variant="ghost" className="h-8 w-8 p-0" onClick={(event) => event.stopPropagation()}><span className="sr-only">{t('remoteAccess.links.openMenu', { defaultValue: 'Open menu' })}</span><MoreVertical className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem id="edit-remote-access-link-menu-item" onClick={(event) => { event.stopPropagation(); openEditor(row); }}>{t('remoteAccess.links.edit')}</DropdownMenuItem><DropdownMenuItem id="delete-remote-access-link-menu-item" onClick={(event) => { event.stopPropagation(); setDeleting(row); }}>{t('remoteAccess.links.delete')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu> },
  ];

  const confirmRemove = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      const result = await deleteRemoteAccessLink(deleting.link_id);
      if (isAssetActionError(result)) {
        toast.error(actionErrorToast(result, t('remoteAccess.links.errors.delete')));
        return;
      }
      setDeleting(null);
      await loadLinks();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('remoteAccess.links.errors.delete'));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="mt-6 rounded-lg border border-[rgb(var(--color-border-200))] p-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">{t('remoteAccess.links.title')}</h2>
          <p className="text-sm text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.description')}</p>
        </div>
        <Button id="remote-access-link-add" onClick={() => openEditor()}>
          {t('remoteAccess.links.add')}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.empty')}</p>
      ) : (
        <DataTable id="remote-access-links-table" data={rows} columns={columns} pagination={false} />
      )}

      <Dialog
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={t(editing ? 'remoteAccess.links.editTitle' : 'remoteAccess.links.addTitle')}
        className="max-w-xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button id="remote-access-link-cancel" variant="secondary" onClick={() => setIsOpen(false)}>
              {t('remoteAccess.links.cancel')}
            </Button>
            <Button id="remote-access-link-save" onClick={() => void save()}>
              {t('remoteAccess.links.save')}
            </Button>
          </div>
        )}
      >
        <DialogContent>
          <div className="space-y-3">
            <label className="block text-sm font-medium" htmlFor="remote-access-link-label">
              {t('remoteAccess.links.label')}
              <Input id="remote-access-link-label" value={label} onChange={(event) => setLabel(event.target.value)} />
            </label>
            <label className="block text-sm font-medium" htmlFor="remote-access-link-template">
              {t('remoteAccess.links.template')}
              <Input id="remote-access-link-template" value={urlTemplate} onChange={(event) => setUrlTemplate(event.target.value)} />
            </label>
            <p className="text-xs text-[rgb(var(--color-text-500))]">{t('remoteAccess.links.tokens')}</p>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmationDialog
        id="remote-access-link-confirm-delete-dialog"
        isOpen={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmRemove}
        title={t('remoteAccess.links.confirmDeleteTitle')}
        message={t('remoteAccess.links.confirmDeleteMessage', { label: deleting?.label ?? '' })}
        confirmLabel={t('remoteAccess.links.delete')}
        cancelLabel={t('remoteAccess.links.cancel')}
        isConfirming={isDeleting}
      />
      <ConfirmationDialog id="remote-access-links-confirm-bulk-delete-dialog" isOpen={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} onConfirm={confirmBulkRemove} title={t('remoteAccess.links.confirmBulkDeleteTitle', { defaultValue: 'Delete selected links?' })} message={t('remoteAccess.links.confirmBulkDeleteMessage', { defaultValue: 'Delete {{count}} selected remote access link(s)?', count: selectedIds.length })} confirmLabel={t('remoteAccess.links.delete')} cancelLabel={t('remoteAccess.links.cancel')} isConfirming={isDeleting} />
      <BulkActionBar idPrefix="remote-access-links-bulk-action-bar" count={selectedIds.length} selectedLabel={t('remoteAccess.links.selectedCount', { defaultValue: '{{count}} selected', count: selectedIds.length })} onClear={() => setSelectedIds([])} actions={[{ id: 'delete', label: t('remoteAccess.links.delete'), icon: <Trash2 className="h-4 w-4" />, destructive: true, onClick: () => setConfirmBulkDelete(true) }]} />
    </section>
  );
}
