'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import { MoreVertical } from 'lucide-react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import { Dialog, DialogContent } from '@alga-psa/ui/components/Dialog';
import { ConfirmationDialog } from '@alga-psa/ui/components/ConfirmationDialog';
import { ClientPicker } from '@alga-psa/ui/components/ClientPicker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@alga-psa/ui/components/DropdownMenu';
import type { ColumnDefinition } from '@alga-psa/types';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import NumberingSettings from '@alga-psa/reference-data/components/settings/NumberingSettings';
import {
  activateAssetTagUniqueness,
  canManageAssetNumbering,
  listAssetClientPrefixes,
  listAssetTagAudit,
  markAssetTagAuditReviewed,
  getAssetSequenceContinuationReview,
  updateClientAssetPrefix,
} from '../../actions/assetNumberingActions';

type ClientPrefix = { client_id: string; client_name: string; asset_prefix: string | null; is_inactive?: boolean };
type AuditRow = { audit_id: string; asset_id: string; asset_tag: string; normalized_tag: string | null; reason: string; resolved_at: string | null; resolution_note: string | null };
type ContinuationReview = { scannedTags: number; numericSuffixTags: number; maximumSuffix: string; suggestedNextValue: string; examples: string[] };

export default function AssetNumberingSettings() {
  const { t } = useTranslation(['msp/settings', 'common']);
  const [clients, setClients] = useState<ClientPrefix[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [editor, setEditor] = useState<{ clientId: string | null; prefix: string; editing: boolean } | null>(null);
  const [removing, setRemoving] = useState<ClientPrefix | null>(null);
  const [saving, setSaving] = useState(false);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<ContinuationReview | null>(null);
  const [canManage, setCanManage] = useState(false);

  const reload = useCallback(async () => {
    const [nextClients, nextAudit, review, manage] = await Promise.all([
      listAssetClientPrefixes(), listAssetTagAudit(), getAssetSequenceContinuationReview(), canManageAssetNumbering(),
    ]);
    setCanManage(manage);
    setClients(nextClients as ClientPrefix[]);
    setAudit(nextAudit as AuditRow[]);
    setContinuation(review as ContinuationReview);
  }, []);

  useEffect(() => {
    void reload().catch(() => setError(t('assets.numbering.loadFailed', { defaultValue: 'Could not load asset numbering settings' })));
  }, [reload, t]);

  const [editorError, setEditorError] = useState<string | null>(null);
  const openEditor = (client?: ClientPrefix) => {
    setEditorError(null);
    setEditor(client
      ? { clientId: client.client_id, prefix: client.asset_prefix ?? '', editing: true }
      : { clientId: null, prefix: '', editing: false });
  };

  const savePrefix = async () => {
    if (!editor?.clientId || !editor.prefix.trim()) return;
    setSaving(true);
    try {
      const result = await updateClientAssetPrefix(editor.clientId, editor.prefix);
      if (!result.success) { setEditorError(result.error ?? t('assets.numbering.saveFailed')); return; }
      setEditor(null);
      toast.success(t('assets.numbering.prefixSaved', { defaultValue: 'Client prefix saved' }));
      await reload();
    } finally { setSaving(false); }
  };

  const removePrefix = async () => {
    if (!removing) return;
    setSaving(true);
    try {
      const result = await updateClientAssetPrefix(removing.client_id, '');
      if (!result.success) { setError(result.error ?? t('assets.numbering.saveFailed')); return; }
      setError(null);
      toast.success(t('assets.numbering.prefixRemoved', { defaultValue: 'Client prefix removed' }));
      await reload();
    } finally { setSaving(false); setRemoving(null); }
  };

  const columns = useMemo<ColumnDefinition<ClientPrefix>[]>(() => [
    {
      title: t('assets.numbering.columns.client', { defaultValue: 'Client' }),
      dataIndex: 'client_name',
      render: (name: string, row) => <span>{name}{row.is_inactive && <span className="ml-2 text-xs text-[rgb(var(--color-text-500))]">{t('assets.numbering.inactive', { defaultValue: 'Inactive' })}</span>}</span>,
    },
    {
      title: t('assets.numbering.columns.prefix', { defaultValue: 'Prefix' }),
      dataIndex: 'asset_prefix',
      render: (prefix: string) => <span className="font-mono">{prefix}</span>,
    },
    ...(canManage ? [{
      title: '',
      id: 'actions',
      dataIndex: 'client_id',
      width: '64px',
      sortable: false,
      render: (_: string, row: ClientPrefix) => <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button id={`asset-prefix-actions-${row.client_id}`} variant="ghost" className="h-8 w-8 p-0">
            <span className="sr-only">{t('assets.numbering.openMenu', { defaultValue: 'Open menu' })}</span>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem id={`asset-prefix-edit-${row.client_id}`} onClick={() => openEditor(row)}>
            {t('assets.numbering.edit', { defaultValue: 'Edit' })}
          </DropdownMenuItem>
          <DropdownMenuItem id={`asset-prefix-remove-${row.client_id}`} onClick={() => setRemoving(row)}>
            {t('assets.numbering.remove', { defaultValue: 'Remove' })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    } satisfies ColumnDefinition<ClientPrefix>] : []),
  ], [canManage, t]);

  const activate = async () => {
    const result = await activateAssetTagUniqueness();
    if (!result.success) { setError(result.error ?? t('assets.numbering.activationFailed')); return; }
    toast.success(t('assets.numbering.uniquenessEnabled', { defaultValue: 'Asset tag uniqueness is active' }));
  };

  const markReviewed = async (row: AuditRow) => {
    await markAssetTagAuditReviewed(row.audit_id, reviewNotes[row.audit_id] ?? 'Reviewed existing blank tag; retained unchanged.');
    await reload();
  };

  return <div className="space-y-6">
    <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5">
      <h2 className="text-lg font-semibold">{t('assets.numbering.title', { defaultValue: 'Asset numbering' })}</h2>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-600))]">{t('assets.numbering.description', { defaultValue: 'One tenant-wide sequence is formatted with each client’s prefix. Previewing and printing do not allocate numbers. Abandoned issued numbers leave gaps and are never reused.' })}</p>
      <div className="mt-4"><NumberingSettings entityType="ASSET" /></div>
      {continuation && <p className="mt-3 rounded-md bg-[rgb(var(--color-background))] p-3 text-sm">{t('assets.numbering.continuationReview', {
        scanned: continuation.scannedTags,
        numeric: continuation.numericSuffixTags,
        maximum: continuation.maximumSuffix,
        next: continuation.suggestedNextValue,
      })}{continuation.examples.length > 0 && <> {t('assets.numbering.continuationExamples', { examples: continuation.examples.join(', ') })}</>}</p>}
    </section>

    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!error && !canManage && <Alert><AlertDescription>{t('assets.numbering.readOnly', { defaultValue: 'You can view asset numbering. Changing it requires permission to update system settings.' })}</AlertDescription></Alert>}

    <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-base font-semibold">{t('assets.numbering.clientPrefixes', { defaultValue: 'Client prefixes' })}</h3>
        <Button id="asset-prefix-add" disabled={!canManage} onClick={() => openEditor()}>{t('assets.numbering.addPrefix', { defaultValue: 'Add prefix' })}</Button>
      </div>
      {clients.length === 0
        ? <p className="text-sm text-[rgb(var(--color-text-500))]">{t('assets.numbering.noPrefixes', { defaultValue: 'No client prefixes yet.' })}</p>
        : <DataTable id="asset-client-prefixes-table" data={clients} columns={columns} pagination={clients.length > 10} pageSize={10} />}
    </section>

    <Dialog
      id="asset-prefix-editor"
      isOpen={Boolean(editor)}
      onClose={() => setEditor(null)}
      title={editor?.editing
        ? t('assets.numbering.editPrefixTitle', { defaultValue: 'Edit client prefix' })
        : t('assets.numbering.addPrefixTitle', { defaultValue: 'Add client prefix' })}
      className="max-w-lg"
      footer={<div className="flex justify-end gap-2">
        <Button id="asset-prefix-cancel" variant="secondary" onClick={() => setEditor(null)}>{t('actions.cancel', { ns: 'common', defaultValue: 'Cancel' })}</Button>
        <Button id="asset-prefix-save" disabled={saving || !editor?.clientId || !editor?.prefix.trim()} onClick={() => void savePrefix()}>{t('actions.save', { ns: 'common', defaultValue: 'Save' })}</Button>
      </div>}
    >
      <DialogContent>
        {editor && <div className="space-y-4">
          {editorError && <Alert variant="destructive"><AlertDescription>{editorError}</AlertDescription></Alert>}
          <div>
            <label className="mb-1 block text-sm font-medium">{t('assets.numbering.columns.client', { defaultValue: 'Client' })}</label>
            <ClientPicker
              id="asset-prefix-client"
              selectedClientId={editor.clientId}
              onSelect={(clientId) => setEditor((current) => current && { ...current, clientId })}
              excludeIds={clients.map((client) => client.client_id)}
              knownClients={editor.editing ? clients.filter((client) => client.client_id === editor.clientId) : undefined}
              disabled={editor.editing}
              filterState="active"
              onFilterStateChange={() => undefined}
              clientTypeFilter="all"
              onClientTypeFilterChange={() => undefined}
            />
          </div>
          <Input
            id="asset-prefix-input"
            label={t('assets.numbering.columns.prefix', { defaultValue: 'Prefix' })}
            value={editor.prefix}
            maxLength={10}
            onChange={(event) => setEditor((current) => current && { ...current, prefix: event.target.value })}
          />
          <p className="text-xs text-[rgb(var(--color-text-500))]">{t('assets.numbering.prefixHelp', { defaultValue: 'Up to 10 letters, digits, or hyphens.' })}</p>
        </div>}
      </DialogContent>
    </Dialog>

    <ConfirmationDialog
      id="asset-prefix-remove-dialog"
      isOpen={Boolean(removing)}
      onClose={() => setRemoving(null)}
      onConfirm={removePrefix}
      title={t('assets.numbering.removeTitle', { defaultValue: 'Remove prefix?' })}
      message={t('assets.numbering.removeMessage', { defaultValue: 'Remove the prefix for {{client}}? New asset numbers for this client will have no prefix. Existing tags are not changed.', client: removing?.client_name ?? '' })}
      confirmLabel={t('assets.numbering.remove', { defaultValue: 'Remove' })}
      cancelLabel={t('actions.cancel', { ns: 'common', defaultValue: 'Cancel' })}
      isConfirming={saving}
    />

    <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5">
      <h3 className="text-base font-semibold">{t('assets.numbering.legacyAudit', { defaultValue: 'Legacy tag audit' })}</h3>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-600))">{t('assets.numbering.legacyAuditHelp', { defaultValue: 'Existing tags are preserved. Reconcile duplicates by editing the affected asset tags; review blank tags without changing them if they are intentionally blank.' })}</p>
      <div className="mt-3 space-y-3">
        {audit.map((row) => <div key={row.audit_id} className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <div className="text-sm"><a className="underline" href={`/msp/assets/${row.asset_id}`}>{row.asset_tag || t('assets.numbering.blankTag')}</a> · {row.reason}{row.normalized_tag && <> · {t('assets.numbering.normalizedTag', { tag: row.normalized_tag })}</>}</div>
          {row.resolved_at ? <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{row.resolution_note}</p> : <div className="mt-2 flex gap-2">
            <Input id={`asset-tag-audit-note-${row.audit_id}`} value={reviewNotes[row.audit_id] ?? ''} disabled={!canManage} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.audit_id]: event.target.value }))} placeholder={t('assets.numbering.reconciliationNote', { defaultValue: 'Human reconciliation note' })} />
            <Button id={`review-asset-tag-audit-${row.audit_id}`} variant="outline" disabled={!canManage} onClick={() => void markReviewed(row)}>{t('assets.numbering.markReviewed', { defaultValue: 'Mark reviewed' })}</Button>
          </div>}
        </div>)}
        {audit.length === 0 && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('assets.numbering.noLegacyIssues', { defaultValue: 'No blank or duplicate tags were found at migration time.' })}</p>}
      </div>
      <Button id="activate-asset-tag-uniqueness" className="mt-4" disabled={!canManage} onClick={() => void activate()}>{t('assets.numbering.activate', { defaultValue: 'Activate unique asset tags' })}</Button>
    </section>
  </div>;
}
