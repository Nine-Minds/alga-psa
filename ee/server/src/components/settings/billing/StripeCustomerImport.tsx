'use client';

/**
 * Import existing Stripe customers and saved cards into auto-pay.
 *
 * Flow: enter/upload rows or run assisted match -> preview (the classifier's output, rendered verbatim)
 * -> per-row enroll attestation -> execute -> result report. This component holds NO import rules;
 * every action/reason shown comes from the server-side plan.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@alga-psa/ui/components/Card';
import { Button } from '@alga-psa/ui/components/Button';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { TextArea } from '@alga-psa/ui/components/TextArea';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Upload } from 'lucide-react';
import {
  previewStripeImportAction,
  proposeStripeImportMatchesAction,
  executeStripeImportAction,
} from '@ee/lib/actions/stripe-import-actions';
import { parseImportCsv, type RawImportRow } from '@ee/lib/payments/stripeImportRows';
import type { ImportPlan, MatchAmbiguity, RowPlan } from '@ee/lib/payments/stripeImportClassifier';
import type { ImportRowResult } from '@ee/lib/payments/StripeCustomerImportService';

const CSV_HEADER = 'client,billing_profile,customer_id';
const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);

const CSV_PLACEHOLDER = 'client,billing_profile,customer_id\nAcme Corp,Default,cus_ABC123';

const StripeCustomerImport: React.FC = () => {
  const { t } = useTranslation('msp/billing-settings');
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  // allRows: everything the operator entered. excluded: indices into allRows the operator unchecked.
  // The server only ever previews/executes the included rows, so the digest always matches what is applied.
  const [allRows, setAllRows] = useState<RawImportRow[]>([]);
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [ambiguous, setAmbiguous] = useState<MatchAmbiguity[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [digest, setDigest] = useState('');
  // Attestation is keyed by index into allRows so it survives a re-preview triggered by include/exclude.
  const [attested, setAttested] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<ImportRowResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [matchNote, setMatchNote] = useState<string | null>(null);
  // Names learned from previewed rows, by index into allRows, so an unchecked row (which has no plan row) can still show names.
  const [knownNames, setKnownNames] = useState<Record<number, { client?: string; profile?: string }>>({});

  const reset = () => { setPlan(null); setResults(null); setAttested(new Set()); setExcluded(new Set()); setAmbiguous([]); setMatchNote(null); };

  const includedIndexes = (rows: RawImportRow[], skip: Set<number>) => rows.map((_, i) => i).filter((i) => !skip.has(i));

  const runPreview = async (input: RawImportRow[], skip: Set<number> = new Set()) => {
    const included = includedIndexes(input, skip);
    if (included.length === 0) { toast.error(t('payment.import.errors.noRows', { defaultValue: 'Add at least one row' })); return; }
    setBusy(true);
    try {
      const res = await previewStripeImportAction({ rows: included.map((i) => input[i]) });
      if (!res.success || !res.data) { toast.error(res.error ?? t('payment.import.errors.preview', { defaultValue: 'Preview failed' })); return; }
      const sameInput = input === allRows; // include/exclude re-preview keeps learned names; a fresh input starts over
      setKnownNames((prevNames) => {
        const prev = sameInput ? prevNames : {};
        const next = { ...prev };
        res.data!.plan.rows.forEach((planRow, position) => {
          next[included[position]] = { client: planRow.clientName ?? prev[included[position]]?.client, profile: planRow.profileName ?? prev[included[position]]?.profile };
        });
        return next;
      });
      setAllRows(input); setExcluded(skip); setPlan(res.data.plan); setDigest(res.data.digest); setResults(null);
    } finally { setBusy(false); }
  };

  const toggleInclude = async (index: number, include: boolean) => {
    const next = new Set(excluded);
    if (include) next.delete(index); else next.add(index);
    await runPreview(allRows, next);
  };

  const addAmbiguousRow = (customerId: string) => setCsv((prev) => `${prev.trimEnd()}${prev.trim() ? '\n' : ''},,${customerId}`);

  const handlePreviewCsv = async () => {
    const parsed = parseImportCsv(csv);
    if (parsed.length === 0) { toast.error(t('payment.import.errors.noRows', { defaultValue: 'Add at least one row' })); return; }
    setAttested(new Set());
    await runPreview(parsed);
  };

  const handleAssisted = async () => {
    setBusy(true);
    try {
      const res = await proposeStripeImportMatchesAction();
      if (!res.success || !res.data) { toast.error(res.error ?? t('payment.import.errors.match', { defaultValue: 'Matching failed' })); return; }
      const { proposals, ambiguous: ambiguousMatches, truncated } = res.data;
      setAmbiguous(ambiguousMatches);
      setMatchNote(t('payment.import.assisted.summary', {
        defaultValue: '{{matched}} proposed, {{ambiguous}} ambiguous (not proposed){{truncated}}',
        matched: proposals.length, ambiguous: ambiguousMatches.length,
        truncated: truncated ? t('payment.import.assisted.truncated', { defaultValue: '; list truncated' }) : '',
      }));
      if (proposals.length === 0) return;
      setBusy(false);
      setAttested(new Set());
      // Seed the CSV box with the matched rows (parser column order) so "Add as row" on an ambiguous match
      // appends to ONE combined input; re-previewing the CSV then keeps the matched rows. Preview still
      // goes through the server classifier on exactly the parsed rows.
      const seeded = [CSV_HEADER, ...proposals.map((p) => [p.clientId, p.billingProfileId, p.customerId].map(csvCell).join(','))].join('\n');
      setCsv(seeded);
      await runPreview(parseImportCsv(seeded).map((row) => ({ ...row, source: 'assisted' as const })));
    } finally { setBusy(false); }
  };

  const handleFile = async (file: File | undefined) => {
    if (file) setCsv(await file.text());
  };

  const handleExecute = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const included = includedIndexes(allRows, excluded);
      // Plan row ids are positions in the included list; map our allRows-keyed attestations onto them.
      const attestedRowIds = included.flatMap((allIndex, position) => (attested.has(allIndex) ? [plan.rows[position].rowId] : []));
      const res = await executeStripeImportAction({ rows: included.map((i) => allRows[i]), planDigest: digest, attestedRowIds });
      if (!res.success || !res.data) { toast.error(res.error ?? t('payment.import.errors.execute', { defaultValue: 'Import failed' })); return; }
      setResults(res.data.results);
      toast.success(t('payment.import.done', { defaultValue: 'Import finished' }));
    } finally { setBusy(false); }
  };

  const toggle = (index: number, on: boolean) => setAttested((prev) => { const next = new Set(prev); if (on) next.add(index); else next.delete(index); return next; });
  const includedIdx = includedIndexes(allRows, excluded);
  const actionable = plan?.rows.some((r, position) => r.action === 'adopt' || attested.has(includedIdx[position])) ?? false;

  const rowLabel = (row: RowPlan) => row.customerName || row.customerEmail || row.customerId;

  return (
    <Card id="stripe-customer-import-card">
      <CardHeader>
        <CardTitle>{t('payment.import.title', { defaultValue: 'Import existing Stripe customers' })}</CardTitle>
        <CardDescription>
          {t('payment.import.description', { defaultValue: 'Bring over Stripe customers and saved cards from another system. Importing never enrolls a client in auto-pay; you confirm that per row.' })}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!open ? (
          <Button id="stripe-import-open" variant="outline" onClick={() => setOpen(true)}>
            {t('payment.import.open', { defaultValue: 'Start import' })}
          </Button>
        ) : (
          <>
            <div className="space-y-2">
              <TextArea
                id="stripe-import-csv"
                label={t('payment.import.csv.label', { defaultValue: 'Rows (client, billing profile, Stripe customer id)' })}
                value={csv}
                placeholder={CSV_PLACEHOLDER}
                onChange={(e) => setCsv(e.target.value)}
                rows={5}
              />
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-2 text-sm cursor-pointer">
                  <Upload className="h-4 w-4" />
                  <span>{t('payment.import.csv.upload', { defaultValue: 'Upload CSV' })}</span>
                  <input id="stripe-import-file" type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void handleFile(e.target.files?.[0])} />
                </label>
                <Button id="stripe-import-preview" onClick={() => void handlePreviewCsv()} disabled={busy}>
                  {t('payment.import.preview', { defaultValue: 'Preview' })}
                </Button>
                <Button id="stripe-import-assisted" variant="outline" onClick={() => void handleAssisted()} disabled={busy}>
                  {t('payment.import.assisted.run', { defaultValue: 'Match by email, then name' })}
                </Button>
              </div>
              {matchNote && <p className="text-sm text-[rgb(var(--color-text-600))]">{matchNote}</p>}
              {ambiguous.length > 0 && (
                <div id="stripe-import-ambiguous" className="space-y-1">
                  <div className="text-sm font-medium">{t('payment.import.assisted.ambiguousTitle', { defaultValue: 'Ambiguous matches (not proposed)' })}</div>
                  {ambiguous.map((a) => (
                    <div key={a.customerId} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono">{a.customerId}</span>
                      <span>{t('payment.import.assisted.matchedBy', { defaultValue: 'Matched by {{by}}', by: t(`payment.import.assisted.by.${a.matchedBy}`, { defaultValue: a.matchedBy }) })}</span>
                      <span>{t(`payment.import.assisted.ambiguousReasons.${a.reason}`, { defaultValue: a.reason })}</span>
                      <Button id={`stripe-import-add-ambiguous-${a.customerId}`} variant="outline" size="sm" onClick={() => addAmbiguousRow(a.customerId)}>
                        {t('payment.import.assisted.addRow', { defaultValue: 'Add as row' })}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {plan && (
              <div className="space-y-3">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" id="stripe-import-preview-table">
                    <thead>
                      <tr className="text-left border-b border-[rgb(var(--color-border-200))]">
                        <th className="py-2 pr-3">{t('payment.import.table.include', { defaultValue: 'Include' })}</th>
                        <th className="py-2 pr-3">{t('payment.import.table.clientProfile', { defaultValue: 'Client / billing profile' })}</th>
                        <th className="py-2 pr-3">{t('payment.import.table.customer', { defaultValue: 'Stripe customer' })}</th>
                        <th className="py-2 pr-3">{t('payment.import.table.plan', { defaultValue: 'Plan' })}</th>
                        <th className="py-2 pr-3">{t('payment.import.table.cards', { defaultValue: 'Cards' })}</th>
                        <th className="py-2">{t('payment.import.table.enroll', { defaultValue: 'Enroll in auto-pay' })}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRows.map((raw, allIndex) => {
                        const isExcluded = excluded.has(allIndex);
                        const row = isExcluded ? undefined : plan.rows[includedIdx.indexOf(allIndex)];
                        const includeCell = (
                          <td className="py-2 pr-3">
                            <Checkbox
                              id={`stripe-import-include-${allIndex}`}
                              checked={!isExcluded}
                              disabled={busy || !!results}
                              onChange={(e) => void toggleInclude(allIndex, e.target.checked)}
                              label={t('payment.import.table.include', { defaultValue: 'Include' })}
                            />
                          </td>
                        );
                        if (!row) {
                          return (
                            <tr key={`excluded-${allIndex}`} className="align-top border-b border-[rgb(var(--color-border-100))] opacity-60">
                              {includeCell}
                              <td className="py-2 pr-3">{knownNames[allIndex]?.client ?? raw.client}{(knownNames[allIndex]?.profile ?? raw.profile) ? ` / ${knownNames[allIndex]?.profile ?? raw.profile}` : ''}</td>
                              <td className="py-2 pr-3 text-xs">{raw.customerId}</td>
                              <td colSpan={3} />
                            </tr>
                          );
                        }
                        return (
                        <tr key={row.rowId} className="align-top border-b border-[rgb(var(--color-border-100))]">
                          {includeCell}
                          <td className="py-2 pr-3">
                            <div className="font-medium">{row.clientName ?? raw.client}</div>
                            <div className="text-xs text-[rgb(var(--color-text-500))]">{row.profileName ?? raw.profile ?? ''}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <div className="font-medium">{rowLabel(row)}</div>
                            <div className="text-xs text-[rgb(var(--color-text-500))]">{row.customerId}</div>
                          </td>
                          <td className="py-2 pr-3">
                            <span className="font-medium">{t(`payment.import.actions.${row.action}`, { defaultValue: row.action })}</span>
                            {row.reason && <div className="text-xs">{t(`payment.import.reasons.${row.reason}`, { defaultValue: row.reason })}</div>}
                            {row.warnings.map((w) => (
                              <div key={w} className="text-xs text-[rgb(var(--badge-warning-text))]">{t(`payment.import.warnings.${w}`, { defaultValue: w })}</div>
                            ))}
                          </td>
                          <td className="py-2 pr-3">
                            {row.cards.length === 0 && <span className="text-xs">&mdash;</span>}
                            {row.cards.map((card) => (
                              <div key={card.externalPaymentMethodId} className="text-xs">
                                {card.brand ?? card.type} {card.last4 ? `•••• ${card.last4}` : ''} &middot; {t(`payment.import.cardActions.${card.action}`, { defaultValue: card.action })}
                                {card.reason ? ` (${t(`payment.import.cardReasons.${card.reason}`, { defaultValue: card.reason })})` : ''}
                                {card.setAsDefault ? ` · ${t('payment.import.default', { defaultValue: 'default' })}` : ''}
                                {card.scaRisk && card.action !== 'skip' && card.action !== 'conflict' && (
                                  <span className="ml-1 text-[rgb(var(--badge-warning-text))]">
                                    {t('payment.import.scaRisk', { defaultValue: 'SCA risk: no proof it was saved for off-session use' })}
                                  </span>
                                )}
                              </div>
                            ))}
                          </td>
                          <td className="py-2">
                            {row.enrollable ? (
                              <Checkbox
                                id={`stripe-import-enroll-${row.rowId}`}
                                checked={attested.has(allIndex)}
                                onChange={(e) => toggle(allIndex, e.target.checked)}
                                label={t('payment.import.attest', { defaultValue: 'The client has authorized recurring charges to this card' })}
                              />
                            ) : row.alreadyEnrolled ? (
                              <span className="text-xs">{t('payment.import.alreadyEnrolled', { defaultValue: 'Already enrolled' })}</span>
                            ) : <span className="text-xs">&mdash;</span>}
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex gap-2">
                  <Button id="stripe-import-execute" onClick={() => void handleExecute()} disabled={busy || !actionable || !!results}>
                    {t('payment.import.execute', { defaultValue: 'Import' })}
                  </Button>
                  <Button id="stripe-import-reset" variant="outline" onClick={() => { reset(); setCsv(''); }} disabled={busy}>
                    {t('payment.import.reset', { defaultValue: 'Start over' })}
                  </Button>
                </div>
              </div>
            )}

            {results && (
              <Alert>
                <AlertDescription>
                  <div id="stripe-import-results" className="space-y-1">
                    {results.map((r) => (
                      <div key={r.rowId} className="text-sm">
                        {plan?.rows.find((p) => p.rowId === r.rowId)?.customerId}: {t(`payment.import.resultStatus.${r.status}`, { defaultValue: r.status })}
                        {r.reason ? ` (${t(`payment.import.reasons.${r.reason}`, { defaultValue: r.reason })})` : ''}
                        {r.cardsImported > 0 ? ` · ${t('payment.import.cardsImported', { defaultValue: '{{count}} card(s) imported', count: r.cardsImported })}` : ''}
                        {r.enrollment !== 'not-requested' ? ` · ${t(`payment.import.enrollment.${r.enrollment}`, { defaultValue: r.enrollment })}` : ''}
                        {r.error ? ` — ${r.error}` : ''}
                      </div>
                    ))}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
};

export default StripeCustomerImport;
