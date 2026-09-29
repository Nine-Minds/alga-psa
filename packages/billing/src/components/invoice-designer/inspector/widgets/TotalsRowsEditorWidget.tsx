import React, { useCallback, useMemo } from 'react';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import ColorPicker from '@alga-psa/ui/components/ColorPicker';
import { getNodeMetadata } from '../../utils/nodeProps';
import type { DesignerNode } from '../../state/designerStore';
import { useInvoiceDesignerStore } from '../../state/designerStore';

type Props = {
  node: DesignerNode;
};

type TotalsRowRecord = Record<string, unknown> & { id: unknown };

type RowStyleWrapper = 'style' | 'labelStyle';
type RowColorProperty = 'backgroundColor' | 'color';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const readRows = (metadata: Record<string, unknown>): TotalsRowRecord[] =>
  Array.isArray(metadata.totalsRows)
    ? metadata.totalsRows.filter(
        (row): row is TotalsRowRecord => isRecord(row) && typeof row.id === 'string' && row.id.length > 0
      )
    : [];

const sanitizeDomId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^-+|-+$/g, '');

const resolveRowDisplayLabel = (row: TotalsRowRecord): string => {
  const labelText = asTrimmedString(row.label);
  if (labelText.length > 0) {
    return labelText;
  }
  const i18nRef = isRecord(row.__astLabelI18n) ? row.__astLabelI18n : null;
  const refDefault = asTrimmedString(i18nRef?.defaultValue);
  if (refDefault.length > 0) {
    return refDefault;
  }
  return String(row.id);
};

const readInlineColor = (row: TotalsRowRecord, wrapperKey: RowStyleWrapper, property: RowColorProperty): string => {
  const wrapper = isRecord(row[wrapperKey]) ? (row[wrapperKey] as Record<string, unknown>) : null;
  const inline = isRecord(wrapper?.inline) ? (wrapper.inline as Record<string, unknown>) : null;
  return asTrimmedString(inline?.[property]);
};

const isEmptyRecord = (value: Record<string, unknown>): boolean => Object.keys(value).length === 0;

const setInlineColor = (
  row: TotalsRowRecord,
  wrapperKey: RowStyleWrapper,
  property: RowColorProperty,
  value: string | undefined
): TotalsRowRecord => {
  const nextRow = { ...row };
  const wrapper = isRecord(row[wrapperKey]) ? { ...(row[wrapperKey] as Record<string, unknown>) } : {};
  const inline = isRecord(wrapper.inline) ? { ...(wrapper.inline as Record<string, unknown>) } : {};

  if (typeof value === 'string' && value.length > 0) {
    inline[property] = value;
  } else {
    delete inline[property];
  }

  // Prune only the wrappers that color editing emptied. Other row style fields
  // (padding, margin, radius, …) are untouched, and an explicitly set label
  // override is preserved verbatim.
  if (isEmptyRecord(inline)) {
    delete wrapper.inline;
  } else {
    wrapper.inline = inline;
  }
  if (isEmptyRecord(wrapper)) {
    delete nextRow[wrapperKey];
  } else {
    nextRow[wrapperKey] = wrapper;
  }
  return nextRow;
};

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6})$/;

const toPickerHexColor = (value: string): string | null => (HEX_COLOR_RE.test(value) ? value : null);

const panelClass =
  'rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2.5 shadow-sm space-y-2';

type ColorControlProps = {
  domBaseId: string;
  label: string;
  value: string;
  placeholder?: string;
  onValueChange: (next: string, commit: boolean) => void;
  onClear: () => void;
  clearAriaLabel: string;
};

const RowColorControl: React.FC<ColorControlProps> = ({
  domBaseId,
  label,
  value,
  placeholder,
  onValueChange,
  onClear,
  clearAriaLabel,
}) => {
  const pickerColor = toPickerHexColor(value);
  const inputId = `${domBaseId}-value`;
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="block text-[10px] font-medium text-slate-500 dark:text-slate-400">
          {label}
        </label>
        <button
          type="button"
          id={`${domBaseId}-clear`}
          aria-label={clearAriaLabel}
          className="text-[10px] font-medium text-slate-400 dark:text-slate-500 transition-colors hover:text-destructive"
          onClick={onClear}
        >
          ✕
        </button>
      </div>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          data-automation-id={`${domBaseId}-value`}
          className="text-xs"
          containerClassName="flex-1 min-w-0"
          value={value}
          placeholder={placeholder}
          onChange={(event) => onValueChange(event.target.value, false)}
          onBlur={(event) => onValueChange(event.target.value, true)}
        />
        <ColorPicker
          currentBackgroundColor={pickerColor}
          currentTextColor={null}
          onSave={(backgroundColor) => onValueChange(asTrimmedString(backgroundColor ?? ''), true)}
          showTextColor={false}
          previewType="circle"
          colorMode="solid"
          trigger={
            <button
              type="button"
              id={`${domBaseId}-color-picker`}
              className="h-8 w-8 shrink-0 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-[rgb(var(--color-card))] p-0.5 transition-colors hover:border-slate-400 dark:hover:border-slate-500"
              title={label}
              aria-label={label}
            >
              <span className="block h-full w-full rounded" style={{ backgroundColor: pickerColor ?? 'transparent' }} />
            </button>
          }
        />
      </div>
    </div>
  );
};

export const TotalsRowsEditorWidget: React.FC<Props> = ({ node }) => {
  const { t } = useTranslation('msp/invoicing');
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const currentNode = useInvoiceDesignerStore((state) => state.nodesById[node.id] as DesignerNode | undefined);

  const metadata = useMemo(() => getNodeMetadata(currentNode ?? node), [currentNode, node]);
  const rows = useMemo(() => readRows(metadata), [metadata]);

  const updateRows = useCallback(
    (nextRows: TotalsRowRecord[], commit: boolean) => {
      setNodeProp(node.id, 'metadata.totalsRows', nextRows, commit);
    },
    [node.id, setNodeProp]
  );

  const updateRowColor = useCallback(
    (rowId: string, wrapperKey: RowStyleWrapper, property: RowColorProperty, raw: string, commit: boolean) => {
      const nextValue = raw.trim();
      updateRows(
        rows.map((row) => (row.id === rowId ? setInlineColor(row, wrapperKey, property, nextValue || undefined) : row)),
        commit
      );
    },
    [rows, updateRows]
  );

  const clearRowColors = useCallback(
    (rowId: string) => {
      updateRows(
        rows.map((row) => {
          if (row.id !== rowId) {
            return row;
          }
          let next = setInlineColor(row, 'style', 'backgroundColor', undefined);
          next = setInlineColor(next, 'style', 'color', undefined);
          return next;
        }),
        true
      );
    },
    [rows, updateRows]
  );

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
        {t('invoiceDesigner.totalsRowsEditor.noRows', {
          defaultValue: 'This totals block has no saved rows yet. Save the template and reopen it to edit row colors.',
        })}
      </div>
    );
  }

  return (
    <div className="space-y-2" data-automation-id="designer-totals-rows-editor">
      {rows.map((row, index) => {
        const rowId = String(row.id);
        const domBaseId = `designer-totals-row-${sanitizeDomId(rowId)}`;
        const backgroundColor = readInlineColor(row, 'style', 'backgroundColor');
        const rowTextColor = readInlineColor(row, 'style', 'color');
        const labelOverrideColor = readInlineColor(row, 'labelStyle', 'color');
        const label = resolveRowDisplayLabel(row);
        return (
          <div key={rowId} className={panelClass} data-automation-id={`${domBaseId}-card`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
                  {index + 1}
                </span>
                <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-300">{label}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <code className="hidden text-[10px] text-slate-400 dark:text-slate-500 md:inline" title={rowId}>
                  {rowId}
                </code>
                <Button id={`${domBaseId}-reset`} variant="outline" size="xs" onClick={() => clearRowColors(rowId)}>
                  {t('invoiceDesigner.totalsRowsEditor.resetColors', { defaultValue: 'Reset colors' })}
                </Button>
              </div>
            </div>

            <RowColorControl
              domBaseId={`${domBaseId}-background`}
              label={t('invoiceDesigner.totalsRowsEditor.rowBackground', { defaultValue: 'Row background' })}
              value={backgroundColor}
              placeholder="#7c45d3"
              onValueChange={(next, commit) => updateRowColor(rowId, 'style', 'backgroundColor', next, commit)}
              onClear={() => updateRowColor(rowId, 'style', 'backgroundColor', '', true)}
              clearAriaLabel={t('invoiceDesigner.totalsRowsEditor.clearRowBackground', {
                defaultValue: 'Clear row background color',
              })}
            />
            <RowColorControl
              domBaseId={`${domBaseId}-text`}
              label={t('invoiceDesigner.totalsRowsEditor.rowTextColor', { defaultValue: 'Text color' })}
              value={rowTextColor}
              placeholder="#ffffff"
              onValueChange={(next, commit) => updateRowColor(rowId, 'style', 'color', next, commit)}
              onClear={() => updateRowColor(rowId, 'style', 'color', '', true)}
              clearAriaLabel={t('invoiceDesigner.totalsRowsEditor.clearRowTextColor', {
                defaultValue: 'Clear row text color',
              })}
            />

            {labelOverrideColor.length > 0 && (
              <p className="rounded border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-2 py-1.5 text-[10px] leading-snug text-amber-700 dark:text-amber-300">
                {t('invoiceDesigner.totalsRowsEditor.labelColorOverrideNote', {
                  defaultValue:
                    'This label keeps its own saved color and does not inherit the row text color set above. The amount still follows the row text color.',
                })}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
};
