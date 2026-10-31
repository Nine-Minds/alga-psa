import React, { useMemo } from 'react';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { Checkbox } from '@alga-psa/ui/components/Checkbox';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import type { DesignerNode } from '../../state/designerStore';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { getNodeMetadata } from '../../utils/nodeProps';
import {
  BUNDLE_COMPONENT_CELL_FIELDS,
  buildBundleChildRowsPreset,
  detectBundleChildRowsPreset,
  resolveBundleColumnIds,
  type BundleChildRows,
} from '../../../../lib/invoice-template-ast/bundleChildRows';

type Props = { node: DesignerNode };

type PresetValue = 'off' | 'quantities' | 'quantities-and-prices' | 'custom';
type Column = { id: string; header?: string; key?: string; lines?: Array<Record<string, unknown>> } & Record<string, unknown>;

const CLEAR = '__clear__';

/** A bound money field is what lets component prices into client-visible data. */
const bindsPrices = (childRows: unknown): boolean => /component\.(unitPrice|total)/.test(JSON.stringify(childRows ?? ''));

/**
 * "Bundle component rows": shows each service of a Fixed contract line as an
 * indented row under its bundle row. The preset chooses the starting point;
 * the sections below let the author blank parent-row columns and remap or
 * clear any column's component cell.
 */
export const BundleComponentRowsWidget: React.FC<Props> = ({ node }) => {
  const { t } = useTranslation('msp/invoicing');
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const unsetNodeProp = useInvoiceDesignerStore((state) => state.unsetNodeProp);
  const metadata = getNodeMetadata(node) as Record<string, unknown>;
  const current = metadata.bundleChildRows as BundleChildRows | undefined;

  const columns = useMemo<Column[]>(() => {
    const raw = metadata.columns;
    return Array.isArray(raw) ? (raw as Column[]).filter((column) => typeof column?.id === 'string') : [];
  }, [metadata.columns]);
  const columnIds = useMemo(() => resolveBundleColumnIds(columns), [columns]);

  const preset = detectBundleChildRowsPreset(current, columnIds) as PresetValue;
  const enabled = Boolean(current);
  const hasChange = JSON.stringify(current ?? '').includes('component.quantityChange');

  const writeChildRows = (next: BundleChildRows) => setNodeProp(node.id, 'metadata.bundleChildRows', next, true);

  // F052: the subtitle rides on the description column as a muted second line,
  // unless the author already built stacked lines there.
  const ensureSubtitleLine = () => {
    const description = columns.find((column) => column.id === columnIds.description);
    if (!description || (Array.isArray(description.lines) && description.lines.length > 0)) return;
    const nextColumns = columns.map((column) =>
      column.id === description.id
        ? {
            ...column,
            lines: [
              { id: 'description-title', key: typeof column.key === 'string' && column.key ? column.key : 'item.description', style: { inline: { fontWeight: 600 } } },
              { id: 'description-subtitle', key: 'item.subtitle', supplemental: true, style: { inline: { color: '#6b7280', fontSize: '12px' } } },
            ],
          }
        : column,
    );
    setNodeProp(node.id, 'metadata.columns', nextColumns, true);
  };

  const applyPreset = (next: PresetValue, showChange: boolean) => {
    if (next === 'off') {
      unsetNodeProp(node.id, 'metadata.bundleChildRows', true);
      return;
    }
    if (next === 'custom') return;
    if (!enabled) ensureSubtitleLine();
    writeChildRows(buildBundleChildRowsPreset({ prices: next === 'quantities-and-prices', showChange, columnIds }));
  };

  const toggleBlank = (columnId: string, blank: boolean) => {
    if (!current) return;
    const existing = current.parentBlankColumns ?? [];
    const next = blank ? Array.from(new Set([...existing, columnId])) : existing.filter((id) => id !== columnId);
    writeChildRows({ ...current, parentBlankColumns: next });
  };

  const remapCell = (columnId: string, value: string) => {
    if (!current) return;
    const cells = { ...current.cells };
    if (value === CLEAR) {
      delete cells[columnId];
    } else {
      const field = BUNDLE_COMPONENT_CELL_FIELDS.find((entry) => entry.path === value);
      if (!field) return;
      const previous = cells[columnId] ?? {};
      // Keep anything the author layered on (lines, change adornment); swap the bound value.
      const { lines: _lines, ...rest } = previous as Record<string, unknown>;
      cells[columnId] = {
        ...rest,
        value: { type: 'path', path: field.path },
        format: field.format === 'text' ? undefined : field.format,
        ...(columnId === columnIds.description ? { lines: (previous as { lines?: unknown }).lines } : {}),
      } as BundleChildRows['cells'][string];
      if (cells[columnId].format === undefined) delete (cells[columnId] as Record<string, unknown>).format;
      if ((cells[columnId] as Record<string, unknown>).lines === undefined) delete (cells[columnId] as Record<string, unknown>).lines;
    }
    writeChildRows({ ...current, cells });
  };

  const options = [
    { value: 'off', label: t('designer.bundleRows.off', { defaultValue: 'Off' }) },
    { value: 'quantities', label: t('designer.bundleRows.quantities', { defaultValue: 'Quantities only' }) },
    { value: 'quantities-and-prices', label: t('designer.bundleRows.quantitiesAndPrices', { defaultValue: 'Quantities and prices' }) },
    ...(preset === 'custom'
      ? [{ value: 'custom', label: t('designer.bundleRows.custom', { defaultValue: 'Custom' }) }]
      : []),
  ];

  const cellOptions = [
    { value: CLEAR, label: t('designer.bundleRows.cellClear', { defaultValue: '— Empty —' }) },
    { value: 'component.name', label: t('designer.bundleRows.field.name', { defaultValue: 'Service name' }) },
    { value: 'component.quantity', label: t('designer.bundleRows.field.quantity', { defaultValue: 'Quantity' }) },
    { value: 'component.periodLabelStart|daterange', label: t('designer.bundleRows.field.period', { defaultValue: 'Service period' }) },
    { value: 'component.pricingBasis', label: t('designer.bundleRows.field.pricingBasis', { defaultValue: 'Pricing basis' }) },
    { value: 'component.unitPrice', label: t('designer.bundleRows.field.unitPrice', { defaultValue: 'Unit price' }) },
    { value: 'component.total', label: t('designer.bundleRows.field.total', { defaultValue: 'Amount' }) },
  ];

  return (
    <div className="space-y-3" data-testid="bundle-component-rows">
      <CustomSelect
        id="bundle-component-rows-preset"
        value={preset}
        options={options}
        onValueChange={(value) => applyPreset(value as PresetValue, hasChange || !enabled)}
      />
      {enabled && (
        <Checkbox
          id="bundle-component-rows-change"
          label={t('designer.bundleRows.showChange', { defaultValue: 'Show change from the previous period (+N / −N)' })}
          checked={hasChange}
          disabled={preset === 'custom'}
          onChange={(event) => applyPreset(bindsPrices(current) ? 'quantities-and-prices' : 'quantities', event.target.checked)}
        />
      )}
      {enabled && current && columns.length > 0 && (
        <>
          <fieldset className="space-y-1" data-testid="bundle-blank-columns">
            <legend className="text-xs font-medium">
              {t('designer.bundleRows.blankOnBundle', { defaultValue: 'Blank on the bundle row' })}
            </legend>
            {columns.map((column) => (
              <Checkbox
                key={column.id}
                id={`bundle-blank-${column.id}`}
                label={column.header || column.id}
                checked={(current.parentBlankColumns ?? []).includes(column.id)}
                onChange={(event) => toggleBlank(column.id, event.target.checked)}
              />
            ))}
          </fieldset>
          <fieldset className="space-y-1" data-testid="bundle-cell-map">
            <legend className="text-xs font-medium">
              {t('designer.bundleRows.componentCells', { defaultValue: 'Component row cells' })}
            </legend>
            {columns.map((column) => (
              <div key={column.id} className="flex items-center gap-2">
                <span className="w-24 shrink-0 truncate text-xs">{column.header || column.id}</span>
                <CustomSelect
                  id={`bundle-cell-${column.id}`}
                  value={(current.cells[column.id]?.value as { path?: string } | undefined)?.path ?? CLEAR}
                  options={cellOptions}
                  onValueChange={(value) => remapCell(column.id, value)}
                />
              </div>
            ))}
          </fieldset>
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {bindsPrices(current)
          ? t('designer.bundleRows.pricesNote', { defaultValue: 'Component prices are included in this template’s invoice data, including for clients.' })
          : t('designer.bundleRows.quantitiesNote', { defaultValue: 'Component prices are not exposed to clients by this template.' })}
      </p>
    </div>
  );
};
