'use client';

import React, { useRef, useState } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { Dialog } from '@alga-psa/ui/components/Dialog';
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

const dollars = (cents: number): string =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MAX_LISTED_ISSUES = 20;
const MAX_SAMPLE_ROWS = 8;

export function ImportOpeningBalances({ onApplied }: { onApplied?: () => void | Promise<void> }) {
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
    reader.onerror = () => toast.error("Couldn't read the file.");
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
      toast.error('Choose a CSV file first.');
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
      toast.error(e?.message || 'Validation failed.');
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
      toast.success(
        `Imported ${result.receipts} receipt${result.receipts === 1 ? '' : 's'} (${result.units_created} unit${
          result.units_created === 1 ? '' : 's'
        }, ${dollars(result.total_value_cents)}) as "${result.batch_label}".`,
      );
      setOpen(false);
      reset();
      await onApplied?.();
    } catch (e: any) {
      toast.error(e?.message || 'Import failed — nothing was written.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button id="import-opening-button" variant="outline" onClick={() => { reset(); setOpen(true); }}>
        Import opening balances
      </Button>

      <Dialog
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Import opening balances"
        id="import-opening-dialog"
        className="max-w-3xl"
      >
        <div className="space-y-4 p-1">
          <p className="text-sm text-gray-500">
            Stand up day-one stock from a CSV. Every row lands as a real ledger receipt tagged with the batch
            label — rows with a serial number become individual units, rows without become bulk quantities.{' '}
            <button id="import-template" type="button" className="text-primary-600 underline" onClick={downloadTemplate}>
              Download the template
            </button>{' '}
            for the expected columns.
          </p>

          <div className="flex items-end gap-3 flex-wrap">
            <div>
              <label className="block text-sm font-medium mb-1" htmlFor="import-file-input">
                CSV file
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
                label="Batch label"
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
              Enable stock tracking for products not yet tracked
            </label>
          </div>

          <div className="flex items-center gap-3">
            <Button id="import-validate" variant="outline" onClick={runValidate} disabled={busy !== null || !csvText}>
              {busy === 'validate' ? 'Validating…' : 'Validate'}
            </Button>
            {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
          </div>

          {preview && (
            <div className="space-y-3" id="import-preview">
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm rounded border bg-gray-50 p-3">
                <span>
                  <span className="text-gray-500">Rows:</span> <b>{preview.summary.data_rows}</b>
                </span>
                <span>
                  <span className="text-gray-500">Products:</span> <b>{preview.summary.products}</b>
                </span>
                <span>
                  <span className="text-gray-500">Locations:</span> <b>{preview.summary.locations}</b>
                </span>
                <span>
                  <span className="text-gray-500">Serialized units:</span> <b>{preview.summary.serialized_units}</b>
                </span>
                <span>
                  <span className="text-gray-500">Bulk quantity:</span> <b>{preview.summary.bulk_quantity}</b>
                </span>
                <span>
                  <span className="text-gray-500">Value:</span> <b>{dollars(preview.summary.total_value_cents)}</b>
                </span>
                {preview.summary.settings_to_create > 0 && (
                  <span className="text-amber-700">
                    {preview.summary.settings_to_create} product{preview.summary.settings_to_create === 1 ? '' : 's'}{' '}
                    will be enabled for tracking
                  </span>
                )}
              </div>

              {preview.errors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-3" id="import-errors">
                  <p className="text-sm font-medium text-red-800 mb-1">
                    {preview.errors.length} error{preview.errors.length === 1 ? '' : 's'} — nothing will be imported
                    until every row is clean:
                  </p>
                  <ul className="text-xs text-red-700 space-y-0.5">
                    {preview.errors.slice(0, MAX_LISTED_ISSUES).map((er, i) => (
                      <li key={i}>
                        Row {er.row}: {er.message}
                      </li>
                    ))}
                    {preview.errors.length > MAX_LISTED_ISSUES && (
                      <li>…and {preview.errors.length - MAX_LISTED_ISSUES} more</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.warnings.length > 0 && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3" id="import-warnings">
                  <ul className="text-xs text-amber-800 space-y-0.5">
                    {preview.warnings.slice(0, MAX_LISTED_ISSUES).map((w, i) => (
                      <li key={i}>
                        {w.row != null ? `Row ${w.row}: ` : ''}
                        {w.message}
                      </li>
                    ))}
                    {preview.warnings.length > MAX_LISTED_ISSUES && (
                      <li>…and {preview.warnings.length - MAX_LISTED_ISSUES} more</li>
                    )}
                  </ul>
                </div>
              )}

              {preview.rows.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-1 pr-2 font-medium">Product</th>
                      <th className="py-1 px-2 font-medium">Location</th>
                      <th className="py-1 px-2 font-medium text-right">Qty</th>
                      <th className="py-1 px-2 font-medium">Serial</th>
                      <th className="py-1 pl-2 font-medium text-right">Unit cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, MAX_SAMPLE_ROWS).map((r) => (
                      <tr key={r.row} className="border-b last:border-0">
                        <td className="py-1 pr-2">{r.service_name || r.sku || r.service_id}</td>
                        <td className="py-1 px-2">{r.location_name}</td>
                        <td className="py-1 px-2 text-right tabular-nums">{r.quantity}</td>
                        <td className="py-1 px-2 font-mono text-xs">{r.serial_number || '—'}</td>
                        <td className="py-1 pl-2 text-right tabular-nums">
                          {r.unit_cost_cents != null ? dollars(r.unit_cost_cents) : '—'}
                        </td>
                      </tr>
                    ))}
                    {preview.rows.length > MAX_SAMPLE_ROWS && (
                      <tr>
                        <td colSpan={5} className="py-1 text-xs text-gray-500">
                          …and {preview.rows.length - MAX_SAMPLE_ROWS} more valid rows
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
              Cancel
            </Button>
            <Button id="import-apply" onClick={runApply} disabled={busy !== null || !preview || !preview.ok}>
              {busy === 'apply'
                ? 'Importing…'
                : preview && preview.ok
                  ? `Import ${preview.summary.data_rows} rows`
                  : 'Import'}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
