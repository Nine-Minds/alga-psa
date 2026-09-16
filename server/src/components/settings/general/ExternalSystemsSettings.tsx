'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, MoreVertical, ExternalLink } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@alga-psa/ui/components/DropdownMenu';
import {
  getErrorMessage,
  isActionMessageError,
  isActionPermissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';
import {
  deleteTenantExternalSystem,
  listExternalSystems,
  upsertTenantExternalSystem,
  type ExternalSystemOption,
} from '@alga-psa/tickets/actions/externalLinks/externalLinkActions';

const isReturnedActionError = (
  value: unknown,
): value is ActionMessageError | ActionPermissionError =>
  isActionMessageError(value) || isActionPermissionError(value);

interface SystemFormState {
  key: string;
  label: string;
  urlTemplate: string;
}

const EMPTY_FORM: SystemFormState = {
  key: 'custom:',
  label: '',
  urlTemplate: '',
};

const ExternalSystemsSettings: React.FC = () => {
  const { t } = useTranslation('msp/settings');

  const [systems, setSystems] = useState<ExternalSystemOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [form, setForm] = useState<SystemFormState>(EMPTY_FORM);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<ExternalSystemOption | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchSystems = useCallback(async () => {
    try {
      const result = await listExternalSystems();
      if (isReturnedActionError(result)) {
        setError(getErrorMessage(result));
        return;
      }
      setSystems(result);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    void fetchSystems();
  }, [fetchSystems]);

  const customSystems = useMemo(() => systems.filter((system) => system.isCustom), [systems]);
  const builtInSystems = useMemo(() => systems.filter((system) => !system.isCustom), [systems]);

  const openCreate = () => {
    setEditingKey(null);
    setForm({ ...EMPTY_FORM });
    setDialogError(null);
    setIsDialogOpen(true);
  };

  const openEdit = (system: ExternalSystemOption) => {
    setEditingKey(system.key);
    setForm({
      key: system.key,
      label: system.label,
      urlTemplate: system.url_template ?? '',
    });
    setDialogError(null);
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    setDialogError(null);
    setSaving(true);
    try {
      const result = await upsertTenantExternalSystem({
        key: form.key.trim(),
        label: form.label.trim(),
        url_template: form.urlTemplate.trim() || null,
      });
      if (isReturnedActionError(result)) {
        setDialogError(getErrorMessage(result));
        return;
      }
      toast.success(
        editingKey
          ? t('ticketing.externalSystems.messages.success.updated', 'External system updated.')
          : t('ticketing.externalSystems.messages.success.created', 'External system created.'),
      );
      setIsDialogOpen(false);
      await fetchSystems();
    } catch (err) {
      setDialogError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const result = await deleteTenantExternalSystem(deleteTarget.key);
      if (isReturnedActionError(result)) {
        setDeleteTarget(null);
        toast.error(getErrorMessage(result));
        return;
      }
      toast.success(t('ticketing.externalSystems.messages.success.deleted', 'External system deleted.'));
      setDeleteTarget(null);
      await fetchSystems();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  const columns: ColumnDefinition<ExternalSystemOption>[] = [
    {
      title: t('ticketing.externalSystems.table.label'),
      dataIndex: 'label',
      width: '35%',
      render: (value: string) => <span className="font-medium">{value}</span>,
    },
    {
      title: t('ticketing.externalSystems.table.key'),
      dataIndex: 'key',
      width: '30%',
      render: (value: string) => <span className="font-mono text-xs text-[rgb(var(--color-text-600))]">{value}</span>,
    },
    {
      title: t('ticketing.externalSystems.table.urlTemplate'),
      dataIndex: 'url_template',
      width: '27%',
      render: (value: string | null) => value ?? '-',
    },
    {
      title: t('ticketing.externalSystems.table.actions'),
      // Column identity is derived from dataIndex, so this must not reuse a
      // data column's dataIndex: DataTable resolves the first matching
      // renderer and would paint the Actions cell with the Key column.
      dataIndex: 'actions',
      width: '8%',
      render: (_value: unknown, record: ExternalSystemOption) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              id={`external-system-actions-${record.key.replace(':', '-')}`}
              variant="ghost"
              aria-label={t('ticketing.externalSystems.table.actions')}
              className="h-8 w-8 p-0"
            >
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem id={`external-system-edit-${record.key.replace(':', '-')}`} onClick={() => openEdit(record)}>
              {t('ticketing.externalSystems.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem
              id={`external-system-delete-${record.key.replace(':', '-')}`}
              onClick={() => setDeleteTarget(record)}
              className="text-destructive"
            >
              {t('ticketing.externalSystems.actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const dialogFooter = (
    <div className="flex justify-end space-x-2">
      <Button id="external-system-cancel" type="button" variant="ghost" onClick={() => setIsDialogOpen(false)} disabled={saving}>
        {t('ticketing.externalSystems.actions.cancel')}
      </Button>
      <Button id="external-system-save" type="button" onClick={() => void handleSave()} disabled={saving}>
        {t('ticketing.externalSystems.actions.save')}
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg bg-[rgb(var(--color-card))] p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-[rgb(var(--color-text-800))]">
              {t('ticketing.externalSystems.title')}
            </h3>
            <p className="mt-1 text-sm text-[rgb(var(--color-text-500))]">
              {t('ticketing.externalSystems.subtitle')}
            </p>
          </div>
          <Button id="add-external-system-button" type="button" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            {t('ticketing.externalSystems.addButton')}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <DataTable
          id="external-systems-table"
          data={customSystems}
          columns={columns}
          pagination={false}
        />
      </div>

      <div className="rounded-lg bg-[rgb(var(--color-card))] p-6 shadow-sm">
        <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-[rgb(var(--color-text-700))]">
          <ExternalLink className="h-4 w-4" />
          {t('ticketing.externalSystems.builtInTitle')}
        </h4>
        <p className="mb-3 text-sm text-[rgb(var(--color-text-500))]">
          {t('ticketing.externalSystems.builtInSubtitle')}
        </p>
        <div className="flex flex-wrap gap-2">
          {builtInSystems.map((system) => (
            <span
              key={system.key}
              className="rounded-md border border-[rgb(var(--color-border-200))] px-2 py-1 text-xs text-[rgb(var(--color-text-600))]"
            >
              {system.label}
            </span>
          ))}
        </div>
      </div>

      <Dialog
        id="external-system-dialog"
        isOpen={isDialogOpen}
        onClose={() => setIsDialogOpen(false)}
        title={
          editingKey
            ? t('ticketing.externalSystems.dialog.editTitle')
            : t('ticketing.externalSystems.dialog.addTitle')
        }
        className="max-w-md"
        footer={dialogFooter}
      >
        <DialogContent>
          <form
            id="external-system-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            {dialogError ? (
              <Alert variant="destructive">
                <AlertDescription>{dialogError}</AlertDescription>
              </Alert>
            ) : null}

            <div className="space-y-2">
              <Label htmlFor="external-system-key">{t('ticketing.externalSystems.fields.key')}</Label>
              <Input
                id="external-system-key"
                value={form.key}
                onChange={(event) => setForm((prev) => ({ ...prev, key: event.target.value }))}
                disabled={editingKey !== null}
                placeholder="custom:vendor"
              />
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('ticketing.externalSystems.fields.keyHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="external-system-label">{t('ticketing.externalSystems.fields.label')}</Label>
              <Input
                id="external-system-label"
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="external-system-url-template">
                {t('ticketing.externalSystems.fields.urlTemplate')}
              </Label>
              <Input
                id="external-system-url-template"
                value={form.urlTemplate}
                onChange={(event) => setForm((prev) => ({ ...prev, urlTemplate: event.target.value }))}
                placeholder="https://vendor.example/cases/{external_id}"
              />
              <p className="text-xs text-[rgb(var(--color-text-500))]">
                {t('ticketing.externalSystems.fields.urlTemplateHint')}
              </p>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmationDialog
        id="delete-external-system-dialog"
        isOpen={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
        title={t('ticketing.externalSystems.deleteDialog.title')}
        message={t('ticketing.externalSystems.deleteDialog.message', {
          label: deleteTarget?.label ?? '',
        })}
        confirmLabel={t('ticketing.externalSystems.actions.delete')}
        cancelLabel={t('ticketing.externalSystems.actions.cancel')}
        isConfirming={deleting}
      />
    </div>
  );
};

export default ExternalSystemsSettings;
