import React, { useEffect, useRef, useState } from 'react';
import type { TemplateI18nText } from '@alga-psa/types';
import { Input } from '@alga-psa/ui/components/Input';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { StandardLabelControl } from './StandardLabelControl';
import { isTranslatableRef, type TranslatableRef } from '../../utils/translatableText';
import type { ValueLabelSuggestion } from '../../utils/valueLabelSuggestions';

type Props = {
  domId: string;
  valueLabels: Record<string, TemplateI18nText> | undefined;
  /** Known values for the bound field, offered as one-click rows. */
  suggestions: ValueLabelSuggestion[];
  /** Receives the cleaned record (blank keys dropped), or undefined when none remain. */
  onChange: (next: Record<string, TemplateI18nText> | undefined) => void;
};

type Row = { rowId: number; key: string; label: TemplateI18nText };

const labelText = (label: TemplateI18nText): string => (typeof label === 'string' ? label : label.defaultValue);

const buildRecord = (rows: Row[]): Record<string, TemplateI18nText> | undefined => {
  const entries = rows.filter((row) => row.key.trim().length > 0).map((row) => [row.key.trim(), row.label] as const);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};

const buttonClassName =
  'rounded border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-background))] px-1.5 py-0.5 text-[10px] text-[rgb(var(--color-text-600))] hover:border-[rgb(var(--color-border-300))] hover:bg-[rgb(var(--color-border-100))]';

/**
 * Edits `valueLabels`: the wording a table cell prints for a data value
 * (`true` → Yes, `monthly` → Monthly). Each label is fixed text or a standard
 * label translated for each recipient; an empty label prints nothing.
 */
export const ValueLabelsEditor: React.FC<Props> = ({ domId, valueLabels, suggestions, onChange }) => {
  const { t } = useTranslation('msp/invoicing');
  const nextRowId = useRef(0);
  const toRows = (source: Record<string, TemplateI18nText> | undefined): Row[] =>
    Object.entries(source ?? {}).map(([key, label]) => ({ rowId: nextRowId.current++, key, label }));
  const [rows, setRows] = useState<Row[]>(() => toRows(valueLabels));

  // The prop is the source of truth. When it changes to something other than
  // what the local rows already express (another column selected, undo/redo, an
  // outside edit), rebuild the rows from it. Our own commits echo back equal and
  // leave the rows alone, so a draft row with a blank key survives typing.
  const incoming = JSON.stringify(valueLabels ?? null);
  useEffect(() => {
    if (JSON.stringify(buildRecord(rows) ?? null) !== incoming) {
      setRows(toRows(valueLabels));
    }
    // Only a change of the incoming value may trigger a resync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming]);

  const commit = (next: Row[], persist: boolean) => {
    setRows(next);
    if (persist) onChange(buildRecord(next));
  };
  const patchRow = (rowId: number, patch: Partial<Row>, persist: boolean) =>
    commit(rows.map((row) => (row.rowId === rowId ? { ...row, ...patch } : row)), persist);
  const addRows = (additions: Array<Pick<Row, 'key' | 'label'>>) => {
    commit([...rows, ...additions.map((row) => ({ ...row, rowId: nextRowId.current++ }))], true);
  };

  const takenKeys = new Set(rows.map((row) => row.key.trim()));
  const missingSuggestions = suggestions.filter((suggestion) => !takenKeys.has(suggestion.key));

  return (
    <div data-automation-id={`${domId}-value-labels`}>
      <div className="flex items-center justify-between">
        <label className="text-[10px] font-medium text-[rgb(var(--color-text-500))] block mb-0.5">
          {t('invoiceDesigner.tableEditor.columns.valueLabels', { defaultValue: 'Value wording' })}
        </label>
        <div className="flex items-center gap-1">
          {missingSuggestions.length > 0 && (
            <button
              id={`${domId}-add-suggested`}
              type="button"
              className={buttonClassName}
              onClick={() => addRows(missingSuggestions)}
            >
              {t('invoiceDesigner.tableEditor.columns.addKnownValues', { defaultValue: '+ Known values' })}
            </button>
          )}
          <button
            id={`${domId}-add-value`}
            type="button"
            className={buttonClassName}
            onClick={() => addRows([{ key: '', label: '' }])}
          >
            {t('invoiceDesigner.tableEditor.columns.addValueLabel', { defaultValue: '+ Value' })}
          </button>
        </div>
      </div>
      <p className="mb-1 text-[10px] text-[rgb(var(--color-text-400))]">
        {t('invoiceDesigner.tableEditor.columns.valueLabelsHint', {
          defaultValue: 'Choose the words printed for a value, such as true → Included. An empty label prints nothing.',
        })}
      </p>
      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.rowId} className="rounded border border-[rgb(var(--color-border-100))] p-1">
            <div className="flex items-center gap-1">
              <Input
                id={`${domId}-key-${row.rowId}`}
                size="sm"
                containerClassName="w-2/5"
                value={row.key}
                aria-label={t('invoiceDesigner.tableEditor.columns.valueLabelKey', { defaultValue: 'Value' })}
                placeholder={t('invoiceDesigner.tableEditor.columns.valueLabelKeyPlaceholder', { defaultValue: 'true' })}
                onChange={(event) => patchRow(row.rowId, { key: event.target.value }, false)}
                onBlur={() => commit(rows, true)}
                className="text-xs font-mono"
              />
              <span aria-hidden className="text-[rgb(var(--color-text-400))]">→</span>
              <Input
                id={`${domId}-label-${row.rowId}`}
                size="sm"
                containerClassName="w-full"
                value={labelText(row.label)}
                aria-label={t('invoiceDesigner.tableEditor.columns.valueLabelText', { defaultValue: 'Printed wording' })}
                placeholder={t('invoiceDesigner.tableEditor.columns.valueLabelTextPlaceholder', { defaultValue: 'Blank' })}
                // Typing replaces any standard label: customizing freezes the text.
                onChange={(event) => patchRow(row.rowId, { label: event.target.value }, false)}
                onBlur={() => commit(rows, true)}
                className="text-xs"
              />
              <button
                id={`${domId}-remove-${row.rowId}`}
                type="button"
                aria-label={t('invoiceDesigner.tableEditor.columns.removeValueLabel', { defaultValue: 'Remove wording' })}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[rgb(var(--color-text-400))] hover:text-destructive hover:bg-destructive/10"
                onClick={() => commit(rows.filter((entry) => entry.rowId !== row.rowId), true)}
              >
                ×
              </button>
            </div>
            <StandardLabelControl
              domId={`${domId}-translation-${row.rowId}`}
              translation={isTranslatableRef(row.label) ? (row.label as TranslatableRef) : null}
              onUseStandardLabel={(ref) => patchRow(row.rowId, { label: { i18nKey: ref.i18nKey, defaultValue: ref.defaultValue } }, true)}
              onUseFixedText={() => patchRow(row.rowId, { label: labelText(row.label) }, true)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
