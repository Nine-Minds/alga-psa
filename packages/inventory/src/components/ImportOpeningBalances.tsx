'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog } from '@alga-psa/ui/components/Dialog';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { useCurrencyFormat } from '@alga-psa/ui/lib';
import { toast } from 'react-hot-toast';
import {
  validateOpeningBalanceImport,
  applyOpeningBalanceImport,
  type OpeningBalanceValidation,
} from '../actions';

/**
 * CSV opening-balance import (Sam review P1 — the migration switch-blocker): stand up
 * day-one stock from a spreadsheet as REAL ledger receipts. Two-phase for safety:
 * validate renders a full preview (errors block, warnings inform), apply is
 * all-or-nothing — a partial import fights the physical shelf forever after.
 */

const TEMPLATE_CSV = [
  'sku,product,location,quantity,serial_number,mac_address,unit_cost',
  'CBL-HDMI21-6,,Main Warehouse,25,,,3.10',
  ',Samsung 990 PRO 1TB SSD,Main Warehouse,,S7XLNS0X123456,,88.00',
  'YLNK-T46U,,Dmitri Van,4,,805EC0AABBCC,155.00',
].join('\n');

const MAX_LISTED_ISSUES = 20;
const MAX_SAMPLE_ROWS = 8;

export function ImportOpeningBalances({
  onApplied,
  defaultCurrencyCode = 'USD',
}: {
  onApplied?: () => void | Promise<void>;
  defaultCurrencyCode?: string;
}) {
  const { t } = useTranslation('features/inventory');
  const { money } = useCurrencyFormat();
  const [open, setOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [batchLabel, setBatchLabel] = useState('opening-balance');
  const [createSettings, setCreateSettings] = useState(true);
  const [preview, setPreview] = useState<OpeningBalanceValidation | null>(null);
  const [busy, setBusy] = useState<'validate' | 'apply' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setCsvText('');
    setFileName('');
    setBatchLabel('opening-balance');
    setCreateSettings(true);
    setPreview(null);
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPreview(null); // stale preview must never authorize an apply of new content
    if (!file) {
      setCsvText('');
      setFileName('');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
      setFileName(file.name);
    };
    reader.onerror = () => toast.error(t('import_.readFileFailed', "Couldn't read the file."));
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE_CSV], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opening-balances-template.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const runValidate = async () => {
    if (!csvText.trim()) {
      toast.error(t('import_.chooseFileFirst', 'Choose a CSV file first.'));
      return;
    }
    setBusy('validate');
    try {
      setPreview(
        await validateOpeningBalanceImport(csvText, {
          batch_label: batchLabel,
          create_missing_settings: createSettings,
        }),
      );
    } catch (e: any) {
      toast.error(e?.message || t('import_.validationFailed', 'Validation failed.'));
    } finally {
      setBusy(null);
    }
  };

  const runApply = async () => {
    if (!preview?.ok || busy) return;
    setBusy('apply');
    try {
      const result = await applyOpeningBalanceImport(csvText, {
        batch_label: batchLabel,
        create_missing_settings: createSettings,
      });
      const receiptsText =
        result.receipts === 1
          ? t('import_.apply.receipt', '{{count}} receipt', { count: result.receipts })
          : t('import_.apply.receipts', '{{count}} receipts', { count: result.receipts });
      const unitsText =
        result.units_created === 1
          ? t('import_.apply.unit', '{{count}} unit', { count: result.units_created })
          : t('import_.apply.units', '{{count}} units', { count: result.units_created });
      toast.success(
        t('import_.apply.success', 'Imported {{receipts}} ({{units}}, {{value}}) as "{{label}}".', {
          receipts: receiptsText,
          units: unitsText,
          value: money(result.total_value_cents, defaultCurrencyCode),
          label: result.batch_label,
        }),
      );
      setOpen(false);
      reset();
      await onApplied?.();
    } catch (e: any) {
      toast.error(e?.message || t('import_.importFailed', 'Import failed — nothing was written.'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button id="import-opening-button" variant="outline" onClick={() => { reset(); setOpen(true); }}>
        {t('import_.openButton', 'Import opening balances')}
      </Button>

      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title={t('import_.dialogTitle', 'Import opening balances')}
        id="import-opening-dialog"
        className="max-w-3xl"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-500">
            {t('import_.intro.text', 'Stand up day-one stock from a CSV. Every row lands as a real ledger receipt tagged with the batch label — rows with a serial number become individual units, rows without become bulk quantities.')}{' '}
            <button id="import-template" type="button" className="text-primary-600 underline" onClick={downloadTemplate}>
              {t('import_.intro.downloadTemplate', 'Download the template')}
            </button>{' '}
            {t('import_.intro.forColumns', 'for the expected columns.')}
          </p>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="import-file-input">
                {t('import_.fields.csvFile', 'CSV file')}
              </label>
              <input
                id="import-file-input"
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={pickFile}
                className="block text-sm"
              />
            </div>
            <div className="w-56">
              <Input
                id="import-batch-label"
                label={t('import_.fields.batchLabel', 'Batch label')}
                value={batchLabel}
                onChange={(e) => {
                  setBatchLabel(e.target.value);
                  setPreview(null);
                }}
              />
            </div>
            <label className="flex items-center gap-2 text-sm pb-2" htmlFor="import-create-settings">
              <Checkbox
                id="import-create-settings"
                checked={createSettings}
                onChange={() => {
                  setCreateSettings((v) => !v);
                  setPreview(null);
                }}
              />
              {t('import_.fields.enableTracking', 'Enable stock tracking for products not yet tracked')}
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button id="import-validate" variant="outline" onClick={runValidate} disabled={busy !== null || !csvText}>
              {busy === 'validate' ? t('import_.actions.validating', 'Validating…') : t('import_.actions.validate', 'Validate')}
            </Button>
            {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
          </div>

          {preview && (
            <div className="space-y-3" id="import-preview">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm rounded border bg-gray-50 p-3">
                <span>
                  <span className="text-gray-500">{t('import_.summary.rows', 'Rows:')}</span> <b>{preview.summary.data_rows}</b>
                </span>
                <span>
                  <span className="text-gray-500">{t('import_.summary.products', 'Products:')}</span> <b>{preview.summary.products}</b>
                </span>
                <span>
                  <span className="text-gray-500">{t('import_.summary.locations', 'Locations:')}</span> <b>{preview.summary.locations}</b>
                </span>
                <span>
                  <span className="text-gray-500">{t('import_.summary.serializedUnits', 'Serialized units:')}</span> <b>{preview.summary.serialized_units}</b>
                </span>
                <span>
                  <span className="text-gray-500">{t('import_.summary.bulkQuantity', 'Bulk quantity:')}</span> <b>{preview.summary.bulk_quantity}</b>
                </span>
                <span>
                  <span className="text-gray-500">{t('import_.summary.value', 'Value:')}</span> <b>{money(preview.summary.total_value_cents, defaultCurrencyCode)}</b>
                </span>
                {preview.summary.settings_to_create > 0 && (
                  <span className="text-amber-700">
                    {preview.summary.settings_to_create === 1
                      ? t('import_.summary.settingWillEnable', '{{count}} product will be enabled for tracking', { count: preview.summary.settings_to_create })
                      : t('import_.summary.settingsWillEnable', '{{count}} products will be enabled for tracking', { count: preview.summary.settings_to_create })}
                  </span>
                )}
              </div>

              {preview.errors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-3" id="import-errors">
                  <p className="text-sm font-medium text-red-800 mb-1">
                    {preview.errors.length === 1
                      ? t('import_.errors.headingSingular', '{{count}} error — nothing will be imported until every row is clean:', { count: preview.errors.length })
                      : t('import_.errors.headingPlural', '{{count}} errors — nothing will be imported until every row is clean:', { count: preview.errors.length })}
                  </p>
                  <ul className="text-xs text-red-700 space-y-0.5">
                    {preview.errors.slice(0, MAX_LISTED_ISSUES).map((er, i) => (
                      <li key={i}>
                        {t('import_.rowPrefix', 'Row {{row}}: ', { row: er.row })}{er.message}
                      </li>
                    ))}
                    {preview.errors.length > MAX_LISTED_ISSUES && (
                      <li>{t('import_.andMore', '…and {{count}} more', { count: preview.errors.length - MAX_LISTED_ISSUES })}</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3" id="import-warnings">
                  <ul className="text-xs text-amber-800 space-y-0.5">
                    {preview.warnings.slice(0, MAX_LISTED_ISSUES).map((w, i) => (
                      <li key={i}>
                        {w.row != null ? t('import_.rowPrefix', 'Row {{row}}: ', { row: w.row }) : ''}
                        {w.message}
                      </li>
                    ))}
                    {preview.warnings.length > MAX_LISTED_ISSUES && (
                      <li>{t('import_.andMore', '…and {{count}} more', { count: preview.warnings.length - MAX_LISTED_ISSUES })}</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.rows.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-1 pr-2 font-medium">{t('import_.table.product', 'Product')}</th>
                      <th className="py-1 px-2 font-medium">{t('import_.table.location', 'Location')}</th>
                      <th className="py-1 px-2 font-medium text-right">{t('import_.table.qty', 'Qty')}</th>
                      <th className="py-1 px-2 font-medium">{t('import_.table.serial', 'Serial')}</th>
                      <th className="py-1 pl-2 font-medium text-right">{t('import_.table.unitCost', 'Unit cost')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, MAX_SAMPLE_ROWS).map((r) => (
                      <tr key={r.row} className="border-b last:border-0">
                        <td className="py-1 pr-2">{r.service_name || r.sku || r.service_id}</td>
                        <td className="py-1 px-2">{r.location_name}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.quantity}</td>
                        <td className="py-1 px-2 font-mono text-xs">{r.serial_number || t('common.emptyValue', '—')}</td>
                        <td className="py-1 pl-2 text-right tabular-nums">
                          {r.unit_cost_cents != null ? money(r.unit_cost_cents, defaultCurrencyCode) : t('common.emptyValue', '—')}
                        </td>
                      </tr>
                    ))}
                    {preview.rows.length > MAX_SAMPLE_ROWS && (
                      <tr>
                        <td colSpan={5} className="py-1 text-xs text-gray-500">
                          {t('import_.andMoreValidRows', '…and {{count}} more valid rows', { count: preview.rows.length - MAX_SAMPLE_ROWS })}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button id="import-cancel" variant="outline" onClick={() => setOpen(false)} disabled={busy === 'apply'}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button id="import-apply" onClick={runApply} disabled={busy !== null || !preview || !preview.ok}>
              {busy === 'apply'
                ? t('import_.actions.importing', 'Importing…')
                : preview && preview.ok
                  ? t('import_.actions.importRows', 'Import {{count}} rows', { count: preview.summary.data_rows })
                  : t('import_.actions.import', 'Import')}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
