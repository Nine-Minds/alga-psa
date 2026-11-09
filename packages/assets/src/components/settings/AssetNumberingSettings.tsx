'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-hot-toast';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import NumberingSettings from '@alga-psa/reference-data/components/settings/NumberingSettings';
import {
  activateAssetTagUniqueness,
  listAssetClientPrefixes,
  listAssetTagAudit,
  markAssetTagAuditReviewed,
  getAssetSequenceContinuationReview,
  updateClientAssetPrefix,
} from '../../actions/assetNumberingActions';

type ClientPrefix = { client_id: string; client_name: string; asset_prefix: string | null };
type AuditRow = { audit_id: string; asset_id: string; asset_tag: string; normalized_tag: string | null; reason: string; resolved_at: string | null; resolution_note: string | null };
type ContinuationReview = { scannedTags: number; numericSuffixTags: number; maximumSuffix: string; suggestedNextValue: string; examples: string[] };

export default function AssetNumberingSettings() {
  const { t } = useTranslation(['msp/settings', 'common']);
  const [clients, setClients] = useState<ClientPrefix[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<ContinuationReview | null>(null);

  const reload = useCallback(async () => {
    const [nextClients, nextAudit, review] = await Promise.all([listAssetClientPrefixes(), listAssetTagAudit(), getAssetSequenceContinuationReview()]);
    setClients(nextClients as ClientPrefix[]);
    setAudit(nextAudit as AuditRow[]);
    setContinuation(review as ContinuationReview);
    setDrafts(Object.fromEntries((nextClients as ClientPrefix[]).map((client) => [client.client_id, client.asset_prefix ?? ''])));
  }, []);

  useEffect(() => { void reload().catch((loadError) => setError(String(loadError))); }, [reload]);

  const savePrefix = async (client: ClientPrefix) => {
    const result = await updateClientAssetPrefix(client.client_id, drafts[client.client_id] ?? '');
    if (!result.success) { setError(result.error ?? t('assets.numbering.saveFailed')); return; }
    setError(null);
    toast.success(t('assets.numbering.prefixSaved', { defaultValue: 'Client prefix saved' }));
    await reload();
  };

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

    <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5">
      <h3 className="text-base font-semibold">{t('assets.numbering.clientPrefixes', { defaultValue: 'Client prefixes' })}</h3>
      <div className="mt-3 divide-y divide-[rgb(var(--color-border-100))]">
        {clients.map((client) => <div key={client.client_id} className="flex flex-wrap items-end gap-3 py-3">
          <div className="min-w-52 flex-1"><Label htmlFor={`asset-prefix-${client.client_id}`}>{client.client_name}</Label>
            <Input id={`asset-prefix-${client.client_id}`} value={drafts[client.client_id] ?? ''} maxLength={10} onChange={(event) => setDrafts((current) => ({ ...current, [client.client_id]: event.target.value }))} placeholder={t('assets.numbering.noPrefix', { defaultValue: 'No prefix' })} />
          </div>
          <Button id={`save-asset-prefix-${client.client_id}`} onClick={() => void savePrefix(client)}>{t('actions.save', { ns: 'common', defaultValue: 'Save' })}</Button>
        </div>)}
      </div>
    </section>

    <section className="rounded-lg border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] p-5">
      <h3 className="text-base font-semibold">{t('assets.numbering.legacyAudit', { defaultValue: 'Legacy tag audit' })}</h3>
      <p className="mt-1 text-sm text-[rgb(var(--color-text-600))">{t('assets.numbering.legacyAuditHelp', { defaultValue: 'Existing tags are preserved. Reconcile duplicates by editing the affected asset tags; review blank tags without changing them if they are intentionally blank.' })}</p>
      <div className="mt-3 space-y-3">
        {audit.map((row) => <div key={row.audit_id} className="rounded-md border border-[rgb(var(--color-border-200))] p-3">
          <div className="text-sm"><a className="underline" href={`/msp/assets/${row.asset_id}`}>{row.asset_tag || t('assets.numbering.blankTag')}</a> · {row.reason}{row.normalized_tag && <> · {t('assets.numbering.normalizedTag', { tag: row.normalized_tag })}</>}</div>
          {row.resolved_at ? <p className="mt-1 text-xs text-[rgb(var(--color-text-500))]">{row.resolution_note}</p> : <div className="mt-2 flex gap-2">
            <Input id={`asset-tag-audit-note-${row.audit_id}`} value={reviewNotes[row.audit_id] ?? ''} onChange={(event) => setReviewNotes((current) => ({ ...current, [row.audit_id]: event.target.value }))} placeholder={t('assets.numbering.reconciliationNote', { defaultValue: 'Human reconciliation note' })} />
            <Button id={`review-asset-tag-audit-${row.audit_id}`} variant="outline" onClick={() => void markReviewed(row)}>{t('assets.numbering.markReviewed', { defaultValue: 'Mark reviewed' })}</Button>
          </div>}
        </div>)}
        {audit.length === 0 && <p className="text-sm text-[rgb(var(--color-text-500))]">{t('assets.numbering.noLegacyIssues', { defaultValue: 'No blank or duplicate tags were found at migration time.' })}</p>}
      </div>
      <Button id="activate-asset-tag-uniqueness" className="mt-4" onClick={() => void activate()}>{t('assets.numbering.activate', { defaultValue: 'Activate unique asset tags' })}</Button>
    </section>
  </div>;
}
