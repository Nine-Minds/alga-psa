'use client';

import React from 'react';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Label } from '@alga-psa/ui/components/Label';
import { Alert, AlertDescription } from '@alga-psa/ui/components/Alert';
import { Badge, type BadgeVariant } from '@alga-psa/ui/components/Badge';
import { DataTable } from '@alga-psa/ui/components/DataTable';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import CurrencyPicker from '@alga-psa/ui/components/CurrencyPicker';
import { DatePicker } from '@alga-psa/ui/components/DatePicker';
import { SpreadsheetColumnMappingStep } from '@alga-psa/ui/components/SpreadsheetColumnMappingStep';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib/currency/useCurrencyFormat';
import type { ColumnDefinition } from '@alga-psa/types';
import { getMigrationConfigurationOptions } from '@/lib/migrations/migrationActions';
import { getTenantDefaultCurrencyCode } from '@alga-psa/billing/actions/billingCurrencyActions';
import {
  applyPriceBookImport,
  getPriceBookImportReport,
  getPriceBookImportReportCsv,
  previewPriceBookImport,
  updatePriceBookJobConfiguration,
  type PriceBookImpactLine,
  type PriceBookImportPreview,
  type PriceBookImportReport,
  type PriceBookPreviewRow,
} from '@/lib/migrations/priceBookImportActions';
import type { CatalogPriceOutcome } from '@/lib/migrations/types';

type Step = 'upload' | 'map' | 'preview' | 'applying' | 'result';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  /** Called after an apply so the list of price books refreshes. */
  onApplied: () => void;
}

const TARGET_KEYS = ['item_kind', 'item_ref', 'sku', 'name', 'service_type', 'price', 'currency', 'cost', 'cost_currency', 'unit_of_measure', 'description', 'category', 'is_active'] as const;
const OUTCOME_VARIANT: Record<CatalogPriceOutcome, BadgeVariant> = {
  create: 'success', update: 'info', unchanged: 'default-muted', unmatched: 'warning', ambiguous: 'warning', conflict: 'error', invalid: 'error',
};
const OUTCOMES: CatalogPriceOutcome[] = ['create', 'update', 'unchanged', 'unmatched', 'ambiguous', 'conflict', 'invalid'];

const todayIso = () => new Date().toISOString().slice(0, 10);
const toIsoDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
/** The next billing period boundary, the default the price change rollout dialog uses. */
const nextMonthBoundary = (): Date => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
};

export default function PriceBookImportDialog({ isOpen, onClose, onApplied }: Props): React.JSX.Element {
  const { t } = useTranslation('msp/billing-settings');
  const format = useCurrencyFormat();

  const [step, setStep] = React.useState<Step>('upload');
  const [file, setFile] = React.useState<File | null>(null);
  const [currency, setCurrency] = React.useState('');
  const [tenantCurrency, setTenantCurrency] = React.useState('');
  const [name, setName] = React.useState('');
  const [effectiveDate, setEffectiveDate] = React.useState<Date>(nextMonthBoundary());
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [sampleRows, setSampleRows] = React.useState<Array<Record<string, string>>>([]);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<PriceBookImportPreview | null>(null);
  const [report, setReport] = React.useState<PriceBookImportReport | null>(null);
  const [outcomeFilter, setOutcomeFilter] = React.useState<string>('all');
  const [serviceTypeId, setServiceTypeId] = React.useState('');
  const [serviceTypes, setServiceTypes] = React.useState<Array<{ id: string; name: string }>>([]);
  const [billingMethod, setBillingMethod] = React.useState<'fixed' | 'hourly' | 'usage'>('fixed');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    void getTenantDefaultCurrencyCode().then((code) => {
      if (typeof code === 'string') { setTenantCurrency(code); setCurrency((current) => current || code); }
    });
  }, [isOpen]);

  const reset = () => {
    setStep('upload'); setFile(null); setName(''); setHeaders([]); setSampleRows([]); setMapping({});
    setJobId(null); setPreview(null); setReport(null); setError(null); setOutcomeFilter('all');
    setEffectiveDate(nextMonthBoundary());
  };
  const close = () => { reset(); onClose(); };

  const headerFor = (extra: Record<string, string> = {}) => ({
    'x-amp-file-name': encodeURIComponent(file!.name),
    'x-amp-file-size': String(file!.size),
    ...extra,
  });

  const targets = React.useMemo(() => [
    ...TARGET_KEYS.map((key) => ({ value: key, label: t(`priceBooks.import.targets.${key}`, { defaultValue: key }) })),
    ...(currency ? [{ value: `price:${currency}`, label: t('priceBooks.import.targets.priceIn', { defaultValue: 'Price in {{currency}}', currency }) }] : []),
    // Any per-currency price column the inference already recognised stays selectable.
    ...Object.values(mapping).filter((value) => value.startsWith('price:') && value !== `price:${currency}`)
      .map((value) => ({ value, label: t('priceBooks.import.targets.priceIn', { defaultValue: 'Price in {{currency}}', currency: value.slice(6) }) })),
  ], [t, currency, mapping]);

  const inspect = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/migrations/spreadsheet/inspect', { method: 'POST', headers: headerFor(), body: file });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'AMP_SPREADSHEET_FAILED');
      setHeaders(body.headers); setSampleRows(body.sampleRows); setMapping(body.mapping);
      setStep('map');
    } catch {
      setError(t('priceBooks.import.errors.unreadable', { defaultValue: 'That file could not be read. Check that it is a CSV or XLSX file with a header row.' }));
    } finally { setBusy(false); }
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch('/api/migrations/spreadsheet', {
        method: 'POST',
        headers: headerFor({
          'x-amp-import-profile': 'price_book',
          'x-amp-price-book-name': encodeURIComponent(name.trim()),
          'x-amp-price-book-effective-date': toIsoDate(effectiveDate),
          'x-amp-job-currency': currency,
          'x-amp-column-mapping': encodeURIComponent(JSON.stringify(mapping)),
        }),
        body: file,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? body.error ?? 'AMP_SPREADSHEET_FAILED');
      setJobId(body.migrationJobId);
      await loadPreview(body.migrationJobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { setBusy(false); }
  };

  const loadPreview = async (id: string) => {
    const result = await previewPriceBookImport(id);
    if ('error' in result) { setError(result.error); return; }
    setPreview(result); setStep('preview');
  };

  const needsServiceConfig = Boolean(preview?.issues.some((issue) => issue.code.startsWith('CONFIG_SERVICE_') || issue.code === 'CONFIG_PRODUCT_SERVICE_TYPE_REQUIRED'));
  React.useEffect(() => {
    if (step !== 'preview' || !jobId || !needsServiceConfig || serviceTypes.length > 0) return;
    void getMigrationConfigurationOptions(jobId).then((options) => setServiceTypes(options.serviceTypes));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, jobId, preview]);

  const saveConfigAndRefresh = async () => {
    if (!jobId) return;
    setBusy(true); setError(null);
    const saved = await updatePriceBookJobConfiguration(jobId, { services: { serviceTypeId, billingMethod }, products: { serviceTypeId } });
    if ('error' in saved) setError(saved.error); else await loadPreview(jobId);
    setBusy(false);
  };

  const apply = async () => {
    if (!jobId) return;
    setBusy(true); setError(null); setStep('applying');
    const queued = await applyPriceBookImport(jobId);
    if ('error' in queued) { setError(queued.error); setStep('preview'); setBusy(false); return; }
    // The run is asynchronous; poll the report until every row has an outcome.
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const current = await getPriceBookImportReport(jobId);
      if ('error' in current) continue;
      if (current.rows.length > 0 && current.rows.every((row) => row.result !== 'pending')) {
        setReport(current); setStep('result'); setBusy(false); onApplied(); return;
      }
    }
    setBusy(false); setError(t('priceBooks.import.errors.slow', { defaultValue: 'The import is still running. Check the price book list in a moment.' })); setStep('preview');
  };

  const downloadReport = async () => {
    if (!jobId) return;
    const csv = await getPriceBookImportReportCsv(jobId);
    if (typeof csv !== 'string') return;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = 'price-book-import-report.csv'; link.click();
    URL.revokeObjectURL(url);
  };

  const money = (minor: number | null, rowCurrency: string | null) =>
    minor === null || !rowCurrency ? '—' : format.money(minor, rowCurrency);

  const hasName = name.trim().length > 0 && effectiveDate.getTime() >= new Date(todayIso()).getTime() - 86_400_000;
  const mappedTargets = new Set(Object.values(mapping));
  const hasPriceColumn = [...mappedTargets].some((value) => value === 'price' || value.startsWith('price:'));
  const hasKeyColumn = ['item_ref', 'sku', 'name'].some((value) => mappedTargets.has(value));

  const rowColumns: ColumnDefinition<PriceBookPreviewRow>[] = [
    { title: t('priceBooks.import.preview.columns.row', { defaultValue: 'Row' }), dataIndex: 'sourceRow', width: '4rem' },
    { title: t('priceBooks.import.preview.columns.item', { defaultValue: 'Item' }), dataIndex: 'itemName', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.import.preview.columns.kind', { defaultValue: 'Kind' }), dataIndex: 'itemKind', render: (value: string | null) => value ? t(`priceBooks.import.kind.${value}`, { defaultValue: value }) : '—' },
    { title: t('priceBooks.import.preview.columns.currency', { defaultValue: 'Currency' }), dataIndex: 'currency', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.import.preview.columns.current', { defaultValue: 'Current price' }), dataIndex: 'currentRateMinor', id: 'current', render: (_: number | null, row: PriceBookPreviewRow) => money(row.currentRateMinor, row.currency) },
    { title: t('priceBooks.import.preview.columns.new', { defaultValue: 'New price' }), dataIndex: 'newRateMinor', id: 'new', render: (_: number | null, row: PriceBookPreviewRow) => money(row.newRateMinor, row.currency) },
    {
      title: t('priceBooks.import.preview.columns.change', { defaultValue: 'Change' }), dataIndex: 'newRateMinor', id: 'change', sortable: false,
      render: (_: number | null, row: PriceBookPreviewRow) => {
        if (row.currentRateMinor === null || row.newRateMinor === null || !row.currency) return '—';
        const delta = row.newRateMinor - row.currentRateMinor;
        const percent = row.currentRateMinor === 0 ? '' : ` (${delta >= 0 ? '+' : ''}${((delta / row.currentRateMinor) * 100).toFixed(1)}%)`;
        return `${format.moneySigned(delta, row.currency)}${percent}`;
      },
    },
    {
      title: t('priceBooks.import.preview.columns.outcome', { defaultValue: 'Outcome' }), dataIndex: 'outcome', id: 'outcome',
      render: (_: string, row: PriceBookPreviewRow) => (
        <div className="space-y-1">
          <Badge variant={OUTCOME_VARIANT[row.outcome]}>{t(`priceBooks.import.outcome.${row.outcome}`, { defaultValue: row.outcome })}</Badge>
          {row.message && <div className="text-xs text-gray-500">{row.message}</div>}
          {row.candidates.length > 0 && (
            <ul className="list-disc pl-4 text-xs text-gray-500">{row.candidates.map((candidate) => <li key={candidate}>{candidate}</li>)}</ul>
          )}
        </div>
      ),
    },
  ];

  const impactColumns: ColumnDefinition<PriceBookImpactLine>[] = [
    { title: t('priceBooks.import.impact.columns.client', { defaultValue: 'Client' }), dataIndex: 'clientName', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.import.impact.columns.contract', { defaultValue: 'Contract' }), dataIndex: 'contractName', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.import.impact.columns.line', { defaultValue: 'Line' }), dataIndex: 'contractLineName', render: (value: string | null) => value ?? '—' },
    { title: t('priceBooks.import.impact.columns.rate', { defaultValue: 'Rate' }), dataIndex: 'currentRateMinor', id: 'rate', sortable: false, render: (_: number | null, row: PriceBookImpactLine) => row.currentRateMinor === null ? (row.reason ?? '—') : `${money(row.currentRateMinor, row.currency)} → ${money(row.newRateMinor, row.currency)}` },
  ];

  const visibleRows = (preview?.rows ?? []).filter((row) => outcomeFilter === 'all' || row.outcome === outcomeFilter);
  const jobBlockers = (preview?.issues ?? []).filter((issue) => issue.severity === 'blocking');

  const impactSections: Array<{ key: 'willChange' | 'custom' | 'unreviewed' | 'excluded'; label: string }> = [
    { key: 'willChange', label: t('priceBooks.import.impact.willChange', { defaultValue: 'Will change' }) },
    { key: 'custom', label: t('priceBooks.import.impact.custom', { defaultValue: 'Keep custom price' }) },
    { key: 'unreviewed', label: t('priceBooks.import.impact.unreviewed', { defaultValue: 'Not yet reviewed' }) },
    { key: 'excluded', label: t('priceBooks.import.impact.excluded', { defaultValue: 'Excluded' }) },
  ];

  return (
    <Dialog id="price-book-import-dialog" isOpen={isOpen} onClose={close} title={t('priceBooks.import.title', { defaultValue: 'New price book from CSV' })} className="max-w-5xl">
      <div className="space-y-4">
        {error && <Alert id="price-book-import-error" variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}

        {step === 'upload' && (
          <div className="space-y-4">
            <div>
              <Label htmlFor="price-book-import-file">{t('priceBooks.import.upload.file', { defaultValue: 'CSV or XLSX file' })}</Label>
              <Input id="price-book-import-file" type="file" accept=".csv,.xlsx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </div>
            <div>
              <Label htmlFor="price-book-import-name">{t('priceBooks.import.upload.name', { defaultValue: 'Price book name' })}</Label>
              <Input id="price-book-import-name" value={name} onChange={(event) => setName(event.target.value)} placeholder={t('priceBooks.import.upload.namePlaceholder', { defaultValue: 'e.g. 2025' })} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="price-book-effective-date">{t('priceBooks.import.upload.effectiveDate', { defaultValue: 'Effective date' })}</Label>
                <DatePicker id="price-book-effective-date" value={effectiveDate} onChange={setEffectiveDate} minDate={new Date()} />
              </div>
              <div>
                <Label htmlFor="price-book-import-currency">{t('priceBooks.import.upload.currency', { defaultValue: 'Currency for blank currency cells' })}</Label>
                <CurrencyPicker id="price-book-import-currency" value={currency || tenantCurrency} onValueChange={setCurrency} />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button id="price-book-import-cancel" variant="outline" onClick={close}>{t('priceBooks.import.cancel', { defaultValue: 'Cancel' })}</Button>
              <Button id="price-book-import-inspect" onClick={inspect} disabled={!file || !hasName || busy}>{t('priceBooks.import.next', { defaultValue: 'Next' })}</Button>
            </div>
          </div>
        )}

        {step === 'map' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t('priceBooks.import.map.help', { defaultValue: 'Check which column holds what. Columns set to "Ignore" are not imported.' })}</p>
            <SpreadsheetColumnMappingStep
              id="price-book-import-mapping"
              headers={headers} sampleRows={sampleRows} targets={targets} mapping={mapping} onMappingChange={setMapping}
              labels={{
                sourceColumn: t('priceBooks.import.map.sourceColumn', { defaultValue: 'Column in file' }),
                sampleValues: t('priceBooks.import.map.sampleValues', { defaultValue: 'Sample values' }),
                mapsTo: t('priceBooks.import.map.mapsTo', { defaultValue: 'Maps to' }),
                ignoreColumn: t('priceBooks.import.map.ignore', { defaultValue: 'Ignore' }),
              }}
            />
            {(!hasPriceColumn || !hasKeyColumn) && (
              <Alert id="price-book-import-map-warning" variant="warning"><AlertDescription>{t('priceBooks.import.map.required', { defaultValue: 'Map a price column and at least one of SKU, name or item ref.' })}</AlertDescription></Alert>
            )}
            <div className="flex justify-between">
              <Button id="price-book-import-back-upload" variant="outline" onClick={() => setStep('upload')}>{t('priceBooks.import.back', { defaultValue: 'Back' })}</Button>
              <Button id="price-book-import-upload" onClick={upload} disabled={busy || !hasPriceColumn || !hasKeyColumn}>{t('priceBooks.import.map.preview', { defaultValue: 'Preview' })}</Button>
            </div>
          </div>
        )}

        {step === 'preview' && preview && (
          <div className="space-y-4">
            <Alert id="price-book-preview-no-writes" variant="info"><AlertDescription>{t('priceBooks.import.preview.noWrites', { defaultValue: 'This is a preview. Nothing has been written to the catalog yet.' })}</AlertDescription></Alert>
            <div id="price-book-preview-counts" className="flex flex-wrap gap-2">
              {OUTCOMES.map((outcome) => (
                <Badge key={outcome} variant={OUTCOME_VARIANT[outcome]}>{t(`priceBooks.import.outcome.${outcome}`, { defaultValue: outcome })}: {preview.counts[outcome]}</Badge>
              ))}
            </div>
            {jobBlockers.length > 0 && (
              <Alert id="price-book-job-blockers" variant="destructive"><AlertDescription><ul className="list-disc pl-4">{jobBlockers.map((issue) => <li key={issue.code}>{issue.message}</li>)}</ul></AlertDescription></Alert>
            )}
            {needsServiceConfig && (
              <div className="grid grid-cols-3 items-end gap-4">
                <div>
                  <Label htmlFor="price-book-service-type">{t('priceBooks.import.config.serviceType', { defaultValue: 'Service type for new items' })}</Label>
                  <CustomSelect
                    id="price-book-service-type" value={serviceTypeId} onValueChange={setServiceTypeId}
                    placeholder={t('priceBooks.import.config.serviceTypePlaceholder', { defaultValue: 'Select a service type' })}
                    options={serviceTypes.map((type) => ({ value: type.id, label: type.name }))}
                  />
                </div>
                <div>
                  <Label htmlFor="price-book-billing-method">{t('priceBooks.import.config.billingMethod', { defaultValue: 'Billing method for new services' })}</Label>
                  <CustomSelect
                    id="price-book-billing-method" value={billingMethod} onValueChange={(value) => setBillingMethod(value as 'fixed' | 'hourly' | 'usage')}
                    options={(['fixed', 'hourly', 'usage'] as const).map((method) => ({ value: method, label: t(`priceBooks.import.config.method.${method}`, { defaultValue: method }) }))}
                  />
                </div>
                <Button id="price-book-save-config" variant="outline" onClick={saveConfigAndRefresh} disabled={busy || !serviceTypeId}>{t('priceBooks.import.config.save', { defaultValue: 'Update preview' })}</Button>
              </div>
            )}
            {preview.blockedRowCount > 0 && (
              <Alert id="price-book-blocked-rows" variant="warning"><AlertDescription>{t('priceBooks.import.preview.blocked', { defaultValue: '{{count}} rows will not be imported. Fix the file and upload it again, or apply the rest.', count: preview.blockedRowCount })}</AlertDescription></Alert>
            )}
            <div className="max-w-xs">
              <CustomSelect
                id="price-book-preview-outcome-filter" value={outcomeFilter} onValueChange={setOutcomeFilter}
                options={[{ value: 'all', label: t('priceBooks.import.preview.allOutcomes', { defaultValue: 'All outcomes' }) }, ...OUTCOMES.map((outcome) => ({ value: outcome, label: t(`priceBooks.import.outcome.${outcome}`, { defaultValue: outcome }) }))]}
              />
            </div>
            <DataTable id="price-book-preview-grid" data={visibleRows} columns={rowColumns} pagination pageSize={10} />

            <div id="price-book-contract-impact" className="space-y-3">
              <h3 className="text-base font-semibold">{t('priceBooks.import.impact.title', { defaultValue: 'Contract impact' })}</h3>
              {impactSections.map(({ key, label }) => (
                <details key={key} id={`price-book-impact-${key}`} className="rounded border p-2">
                  <summary className="cursor-pointer text-sm font-medium">{label} ({preview.impact[key].length})</summary>
                  {preview.impact[key].length > 0 && <DataTable id={`price-book-impact-${key}-table`} data={preview.impact[key]} columns={impactColumns} pagination pageSize={10} />}
                </details>
              ))}
              {Object.entries(preview.impact.totalMonthlyDeltaByCurrency).map(([code, delta]) => (
                <p key={code} className="text-sm">{t('priceBooks.import.impact.monthly', { defaultValue: 'Monthly revenue change ({{currency}}): {{amount}}', currency: code, amount: format.moneySigned(delta, code) })}</p>
              ))}
            </div>

            <div className="flex justify-between">
              <Button id="price-book-import-back-map" variant="outline" onClick={() => setStep('map')}>{t('priceBooks.import.back', { defaultValue: 'Back' })}</Button>
              <Button id="price-book-apply" onClick={apply} disabled={busy || jobBlockers.length > 0}>{t('priceBooks.import.apply', { defaultValue: 'Apply price book' })}</Button>
            </div>
          </div>
        )}

        {step === 'applying' && <p id="price-book-applying" className="text-sm">{t('priceBooks.import.applying', { defaultValue: 'Applying the price book…' })}</p>}

        {step === 'result' && report && (
          <div className="space-y-4">
            <div id="price-book-result-counts" className="flex flex-wrap gap-2">
              {Object.entries(report.counts).map(([key, count]) => <Badge key={key} variant="secondary">{t(`priceBooks.import.result.${key}`, { defaultValue: key })}: {count}</Badge>)}
            </div>
            <div className="flex justify-between">
              <Button id="price-book-download-report" variant="outline" onClick={downloadReport}>{t('priceBooks.import.result.download', { defaultValue: 'Download report' })}</Button>
              <Button id="price-book-import-done" onClick={close}>{t('priceBooks.import.result.done', { defaultValue: 'Done' })}</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
