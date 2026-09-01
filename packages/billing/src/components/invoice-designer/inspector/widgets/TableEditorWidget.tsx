import React, { useCallback, useMemo } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import CustomSelect from '@alga-psa/ui/components/CustomSelect';
import { useTranslation } from '@alga-psa/ui/lib/i18n/client';
import { exportWorkspaceToTemplateAst } from '../../ast/workspaceAst';
import type { DesignerNode } from '../../state/designerStore';
import { createEmptyDesignerTransformWorkspace, useInvoiceDesignerStore } from '../../state/designerStore';
import { hasDesignerTransforms } from '../../transforms/transformWorkspace';
import { getNodeMetadata } from '../../utils/nodeProps';
import { generateUUID } from '@alga-psa/core';

const createLocalId = () => generateUUID();

type Props = {
  node: DesignerNode;
};

type ColumnModel = {
  id: string;
  header?: string;
  key?: string;
  type?: string;
  width?: number;
} & Record<string, unknown>;

// Binding ids are the data contract; only their display labels are translated.
const buildCollectionBindingLabels = (t: TFunction): Record<string, string> => ({
  lineItems: t('invoiceDesigner.tableEditor.bindings.lineItems', { defaultValue: 'All Line Items' }),
  phases: t('invoiceDesigner.tableEditor.bindings.phases', { defaultValue: 'Phases' }),
  recurringItems: t('invoiceDesigner.tableEditor.bindings.recurringItems', { defaultValue: 'Recurring Items' }),
  onetimeItems: t('invoiceDesigner.tableEditor.bindings.onetimeItems', { defaultValue: 'One-time Items' }),
  serviceItems: t('invoiceDesigner.tableEditor.bindings.serviceItems', { defaultValue: 'Service Items' }),
  productItems: t('invoiceDesigner.tableEditor.bindings.productItems', { defaultValue: 'Product Items' }),
  items: t('invoiceDesigner.tableEditor.bindings.items', { defaultValue: 'Items' }),
});

const humanizeCollectionBindingLabel = (bindingId: string, _path: string, t: TFunction): string => {
  return buildCollectionBindingLabels(t)[bindingId] ?? bindingId;
};

type BorderPreset = 'list' | 'boxed' | 'grid' | 'none' | 'custom';

type ColumnPreset = {
  id: string;
  label: string;
  header: string;
  key: string;
  type: string;
  width: number;
  description: string;
};

// Preset ids, binding keys, types and widths are the data contract; only labels are translated.
const buildColumnPresets = (t: TFunction): ColumnPreset[] => [
  {
    id: 'description',
    label: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    header: t('invoiceDesigner.tableEditor.presets.description.label', { defaultValue: 'Description' }),
    key: 'item.description',
    type: 'text',
    width: 280,
    description: t('invoiceDesigner.tableEditor.presets.description.hint', { defaultValue: 'Line item description' }),
  },
  {
    id: 'quantity',
    label: t('invoiceDesigner.tableEditor.presets.quantity.label', { defaultValue: 'Qty' }),
    header: t('invoiceDesigner.tableEditor.presets.quantity.label', { defaultValue: 'Qty' }),
    key: 'item.quantity',
    type: 'number',
    width: 90,
    description: t('invoiceDesigner.tableEditor.presets.quantity.hint', { defaultValue: 'Quantity' }),
  },
  {
    id: 'unit-price',
    label: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    header: t('invoiceDesigner.tableEditor.presets.unitPrice.label', { defaultValue: 'Rate' }),
    key: 'item.unitPrice',
    type: 'currency',
    width: 120,
    description: t('invoiceDesigner.tableEditor.presets.unitPrice.hint', { defaultValue: 'Unit price' }),
  },
  {
    id: 'amount',
    label: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    header: t('invoiceDesigner.tableEditor.presets.amount.label', { defaultValue: 'Amount' }),
    key: 'item.total',
    type: 'currency',
    width: 140,
    description: t('invoiceDesigner.tableEditor.presets.amount.hint', { defaultValue: 'Line total' }),
  },
];

const sanitizeJsonValue = (value: unknown): unknown => {
  if (typeof value === 'undefined') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') return undefined;

  if (Array.isArray(value)) {
    return value.map((entry) => {
      const sanitized = sanitizeJsonValue(entry);
      return typeof sanitized === 'undefined' ? null : sanitized;
    });
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
      const sanitized = sanitizeJsonValue(entry);
      return typeof sanitized === 'undefined' ? [] : ([[key, sanitized]] as const);
    });
    return Object.fromEntries(entries);
  }

  return value;
};

const sanitizeColumnsForPatch = (columns: ColumnModel[]): ColumnModel[] =>
  columns
    .map((column) => sanitizeJsonValue(column))
    .filter(
      (column): column is ColumnModel =>
        typeof column === 'object' &&
        column !== null &&
        !Array.isArray(column) &&
        typeof (column as { id?: unknown }).id === 'string'
      );

const asTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

const resolveTableSourceBindingId = (metadata: Record<string, unknown>): string =>
  asTrimmedString(metadata.collectionBindingKey) ||
  asTrimmedString(metadata.collectionPath) ||
  asTrimmedString(metadata.bindingKey) ||
  asTrimmedString(metadata.path) ||
  'items';

const getUniqueStrings = (values: Array<string | undefined | null>): string[] =>
  Array.from(new Set(values.map((value) => asTrimmedString(value)).filter(Boolean)));

export const TableEditorWidget: React.FC<Props> = ({ node }) => {
  const { t } = useTranslation('msp/invoicing');
  const columnPresets = useMemo(() => buildColumnPresets(t), [t]);
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);
  const nodes = useInvoiceDesignerStore((state) => state.nodes);
  const rootId = useInvoiceDesignerStore((state) => state.rootId);
  const transforms = useInvoiceDesignerStore((state) => state.transforms);
  const snapToGrid = useInvoiceDesignerStore((state) => state.snapToGrid);
  const gridSize = useInvoiceDesignerStore((state) => state.gridSize);
  const showGuides = useInvoiceDesignerStore((state) => state.showGuides);
  const showRulers = useInvoiceDesignerStore((state) => state.showRulers);
  const canvasScale = useInvoiceDesignerStore((state) => state.canvasScale);

  const metadata = useMemo(() => getNodeMetadata(node), [node]);
  const sourceBindingId = useMemo(() => resolveTableSourceBindingId(metadata), [metadata]);
  const isGroupedTransformsOutput = useMemo(() => {
    if (sourceBindingId !== transforms.outputBindingId || !hasDesignerTransforms(transforms)) {
      return false;
    }

    return transforms.operations.some((operation) => operation.type === 'group');
  }, [sourceBindingId, transforms]);

  const columns: ColumnModel[] = useMemo(() => {
    const raw = (metadata as { columns?: unknown }).columns;
    return Array.isArray(raw) ? (raw as ColumnModel[]).filter((col) => typeof col?.id === 'string') : [];
  }, [metadata]);

  const collectionBindingOptions = useMemo(() => {
    const workspaceWithoutTransforms = {
      rootId,
      nodesById: Object.fromEntries(
        nodes.map((entry) => [
          entry.id,
          {
            id: entry.id,
            type: entry.type,
            props: entry.props,
            children: entry.children,
          },
        ])
      ),
      transforms: createEmptyDesignerTransformWorkspace(),
      snapToGrid,
      gridSize,
      showGuides,
      showRulers,
      canvasScale,
    };

    const baseAst = exportWorkspaceToTemplateAst(workspaceWithoutTransforms);
    const options: Array<{ value: string; label: string }> = [];

    if (hasDesignerTransforms(transforms)) {
      options.push({
        value: transforms.sourceBindingId,
        label: t('invoiceDesigner.tableEditor.bindings.transformsSource', {
          defaultValue: '{{binding}} (Transforms source)',
          binding: transforms.sourceBindingId,
        }),
      });
      options.push({
        value: transforms.outputBindingId,
        label: t('invoiceDesigner.tableEditor.bindings.transformsOutput', {
          defaultValue: '{{binding}} (Transforms output)',
          binding: transforms.outputBindingId,
        }),
      });
    }

    options.push(
      ...Object.entries(baseAst.bindings?.collections ?? {}).map(([bindingId, binding]) => ({
        value: bindingId,
        label: humanizeCollectionBindingLabel(bindingId, binding.path, t),
      }))
    );

    if (!options.some((option) => option.value === sourceBindingId)) {
      options.unshift({
        value: sourceBindingId,
        label: humanizeCollectionBindingLabel(sourceBindingId, sourceBindingId, t),
      });
    }

    return options
      .filter((option, index, array) => array.findIndex((candidate) => candidate.value === option.value) === index)
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [
    canvasScale,
    gridSize,
    nodes,
    rootId,
    showGuides,
    showRulers,
    snapToGrid,
    sourceBindingId,
    t,
    transforms,
  ]);

  const bindingKeySuggestions = useMemo(() => {
    const rawSuggestions = getUniqueStrings([
      ...columnPresets.map((preset) => preset.key),
      'item.servicePeriodStart',
      'item.servicePeriodEnd',
      'item.billingTiming',
      ...columns.map((column) => asTrimmedString(column.key)),
    ]);

    if (!isGroupedTransformsOutput) {
      return rawSuggestions;
    }

    const aggregateSuggestions = transforms.operations
      .filter((operation) => operation.type === 'aggregate')
      .flatMap((operation) => operation.aggregations.map((aggregation) => `item.aggregates.${aggregation.id}`));

    return getUniqueStrings([
      'item.key',
      'item.items',
      ...aggregateSuggestions,
    ]);
  }, [columnPresets, columns, isGroupedTransformsOutput, transforms]);

  const resolvedBorderPreset: BorderPreset = useMemo(() => {
    const preset = (metadata as { tableBorderPreset?: unknown }).tableBorderPreset;
    return preset === 'list' || preset === 'boxed' || preset === 'grid' || preset === 'none' ? preset : 'custom';
  }, [metadata]);

  const tableBorderConfig = useMemo(() => {
    if (resolvedBorderPreset === 'list') return { outer: false, rowDividers: true, columnDividers: false };
    if (resolvedBorderPreset === 'boxed') return { outer: true, rowDividers: true, columnDividers: false };
    if (resolvedBorderPreset === 'grid') return { outer: true, rowDividers: true, columnDividers: true };
    if (resolvedBorderPreset === 'none') return { outer: false, rowDividers: false, columnDividers: false };

    return {
      outer: (metadata as { tableOuterBorder?: unknown }).tableOuterBorder !== false,
      rowDividers: (metadata as { tableRowDividers?: unknown }).tableRowDividers !== false,
      columnDividers: (metadata as { tableColumnDividers?: unknown }).tableColumnDividers === true,
    };
  }, [metadata, resolvedBorderPreset]);

  const updateColumns = useCallback(
    (next: ColumnModel[], commit: boolean) => {
      setNodeProp(node.id, 'metadata.columns', sanitizeColumnsForPatch(next), commit);
    },
    [node.id, setNodeProp]
  );

  const updateColumn = useCallback(
    (columnId: string, patch: Partial<ColumnModel>, commit: boolean) => {
      updateColumns(
        columns.map((column) => (column.id === columnId ? { ...column, ...patch } : column)),
        commit
      );
    },
    [columns, updateColumns]
  );

  const appendColumn = useCallback(
    (nextColumn: Omit<ColumnModel, 'id'>) => {
      updateColumns(
        [
          ...columns,
          {
            id: createLocalId(),
            ...nextColumn,
          },
        ],
        true
      );
    },
    [columns, updateColumns]
  );

  const handleAddColumn = useCallback(() => {
    appendColumn({
      header: t('invoiceDesigner.tableEditor.columns.newColumnHeader', { defaultValue: 'New Column' }),
      key: 'item.field',
      type: 'text',
      width: 120,
    });
  }, [appendColumn, t]);

  const handleAddPresetColumn = useCallback(
    (presetId: string) => {
      const preset = columnPresets.find((candidate) => candidate.id === presetId);
      if (!preset) {
        return;
      }
      appendColumn({
        header: preset.header,
        key: preset.key,
        type: preset.type,
        width: preset.width,
      });
    },
    [appendColumn, columnPresets]
  );

  const handleRemoveColumn = useCallback(
    (columnId: string) => updateColumns(columns.filter((column) => column.id !== columnId), true),
    [columns, updateColumns]
  );

  const handleMoveColumn = useCallback(
    (columnId: string, direction: -1 | 1) => {
      const index = columns.findIndex((column) => column.id === columnId);
      if (index < 0) {
        return;
      }
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= columns.length) {
        return;
      }
      const next = [...columns];
      const [moved] = next.splice(index, 1);
      if (!moved) {
        return;
      }
      next.splice(targetIndex, 0, moved);
      updateColumns(next, true);
    },
    [columns, updateColumns]
  );

  const applyTableBorderPreset = useCallback(
    (preset: BorderPreset) => {
      const patch: Array<[string, unknown]> =
        preset === 'list'
          ? [
              ['metadata.tableBorderPreset', 'list'],
              ['metadata.tableOuterBorder', false],
              ['metadata.tableRowDividers', true],
              ['metadata.tableColumnDividers', false],
            ]
          : preset === 'boxed'
            ? [
                ['metadata.tableBorderPreset', 'boxed'],
                ['metadata.tableOuterBorder', true],
                ['metadata.tableRowDividers', true],
                ['metadata.tableColumnDividers', false],
              ]
            : preset === 'grid'
              ? [
                  ['metadata.tableBorderPreset', 'grid'],
                  ['metadata.tableOuterBorder', true],
                  ['metadata.tableRowDividers', true],
                  ['metadata.tableColumnDividers', true],
                ]
              : preset === 'none'
                ? [
                    ['metadata.tableBorderPreset', 'none'],
                    ['metadata.tableOuterBorder', false],
                    ['metadata.tableRowDividers', false],
                    ['metadata.tableColumnDividers', false],
                  ]
                : [['metadata.tableBorderPreset', 'custom']];

      patch.forEach(([path, value], index) => {
        setNodeProp(node.id, path, value, index === patch.length - 1);
      });
    },
    [node.id, setNodeProp]
  );

  const tableHeaderFontWeight = (metadata as { tableHeaderFontWeight?: unknown }).tableHeaderFontWeight;
  const resolvedHeaderWeight =
    tableHeaderFontWeight === 'normal' ||
    tableHeaderFontWeight === 'medium' ||
    tableHeaderFontWeight === 'semibold' ||
    tableHeaderFontWeight === 'bold'
      ? tableHeaderFontWeight
      : 'semibold';

  const panelClass = 'rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2.5 shadow-sm space-y-2';

  return (
    <div className="space-y-3">
      {/* Header with quick-add */}
      <div className="space-y-2">
        <div className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2.5 shadow-sm space-y-2">
          <div>
            <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t('invoiceDesigner.tableEditor.sourceBinding.title', { defaultValue: 'Source Binding' })}
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              {t('invoiceDesigner.tableEditor.sourceBinding.description', {
                defaultValue: 'Bind this table to a raw collection or the authored transforms output.',
              })}
            </p>
          </div>
          <CustomSelect
            id="designer-table-source-binding"
            options={collectionBindingOptions}
            value={sourceBindingId}
            onValueChange={(value: string) => setNodeProp(node.id, 'metadata.collectionBindingKey', value, true)}
            size="sm"
          />
        </div>

        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t('invoiceDesigner.tableEditor.columns.title', { defaultValue: 'Table Columns' })}
          </p>
          <Button id="designer-add-column" variant="outline" size="xs" onClick={handleAddColumn}>
            {t('invoiceDesigner.tableEditor.columns.add', { defaultValue: '+ Column' })}
          </Button>
        </div>
        {!isGroupedTransformsOutput && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 dark:text-slate-500 shrink-0">
              {t('invoiceDesigner.tableEditor.columns.quickAdd', { defaultValue: 'Quick add:' })}
            </span>
            {columnPresets.map((preset) => (
              <button
                key={preset.id}
                id={`designer-add-column-preset-${preset.id}`}
                type="button"
                className="inline-flex h-6 items-center rounded-md border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-2 text-[11px] font-medium text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-500 transition-colors"
                onClick={() => handleAddPresetColumn(preset.id)}
              >
                {preset.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table style */}
      <div className={panelClass}>
        <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t('invoiceDesigner.tableEditor.style.title', { defaultValue: 'Table Style' })}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
              {t('invoiceDesigner.tableEditor.style.borderPreset', { defaultValue: 'Border preset' })}
            </label>
            <CustomSelect
              id="designer-table-border-preset"
              options={[
                { value: 'list', label: t('invoiceDesigner.tableEditor.borderPresets.list', { defaultValue: 'List' }) },
                { value: 'boxed', label: t('invoiceDesigner.tableEditor.borderPresets.boxed', { defaultValue: 'Boxed' }) },
                { value: 'grid', label: t('invoiceDesigner.tableEditor.borderPresets.grid', { defaultValue: 'Grid' }) },
                { value: 'none', label: t('invoiceDesigner.tableEditor.borderPresets.none', { defaultValue: 'None' }) },
                { value: 'custom', label: t('invoiceDesigner.tableEditor.borderPresets.custom', { defaultValue: 'Custom' }) },
              ]}
              value={resolvedBorderPreset}
              onValueChange={(value: string) => applyTableBorderPreset(value as BorderPreset)}
              size="sm"
            />
          </div>
          <div>
            <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
              {t('invoiceDesigner.tableEditor.style.headerWeight', { defaultValue: 'Header weight' })}
            </label>
            <CustomSelect
              id="designer-table-header-weight"
              options={[
                { value: 'normal', label: t('invoiceDesigner.tableEditor.headerWeights.normal', { defaultValue: 'Normal' }) },
                { value: 'medium', label: t('invoiceDesigner.tableEditor.headerWeights.medium', { defaultValue: 'Medium' }) },
                { value: 'semibold', label: t('invoiceDesigner.tableEditor.headerWeights.semibold', { defaultValue: 'Semibold' }) },
                { value: 'bold', label: t('invoiceDesigner.tableEditor.headerWeights.bold', { defaultValue: 'Bold' }) },
              ]}
              value={resolvedHeaderWeight}
              onValueChange={(value: string) => setNodeProp(node.id, 'metadata.tableHeaderFontWeight', value, true)}
              size="sm"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              id="designer-table-border-outer"
              type="checkbox"
              className="rounded border-slate-300 dark:border-slate-600"
              checked={tableBorderConfig.outer}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableOuterBorder', event.target.checked, true);
              }}
            />
            {t('invoiceDesigner.tableEditor.style.borderOuter', { defaultValue: 'Outer' })}
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              id="designer-table-border-rows"
              type="checkbox"
              className="rounded border-slate-300 dark:border-slate-600"
              checked={tableBorderConfig.rowDividers}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableRowDividers', event.target.checked, true);
              }}
            />
            {t('invoiceDesigner.tableEditor.style.borderRows', { defaultValue: 'Rows' })}
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-400 cursor-pointer">
            <input
              id="designer-table-border-columns"
              type="checkbox"
              className="rounded border-slate-300 dark:border-slate-600"
              checked={tableBorderConfig.columnDividers}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableColumnDividers', event.target.checked, true);
              }}
            />
            {t('invoiceDesigner.tableEditor.style.borderColumns', { defaultValue: 'Columns' })}
          </label>
        </div>
      </div>

      {/* Column list */}
      {columns.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-[rgb(var(--color-background))] px-3 py-4 text-center text-xs text-slate-500 dark:text-slate-400">
          {t('invoiceDesigner.tableEditor.columns.empty', {
            defaultValue: 'No columns defined. Add at least one column.',
          })}
        </div>
      )}

      <div className="space-y-2">
        {columns.map((column, index) => (
          <div key={column.id} className="rounded-lg border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-white dark:bg-[rgb(var(--color-card))] px-3 py-2.5 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-medium text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                  {index + 1}
                </span>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  {t('invoiceDesigner.tableEditor.columns.itemLabel', { defaultValue: 'Column' })}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  id={`designer-move-column-up-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={t('invoiceDesigner.tableEditor.columns.moveUp', {
                    defaultValue: 'Move {{column}} up',
                    column: column.id,
                  })}
                  disabled={index === 0}
                  className="h-6 w-6 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => handleMoveColumn(column.id, -1)}
                >
                  ↑
                </Button>
                <Button
                  id={`designer-move-column-down-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={t('invoiceDesigner.tableEditor.columns.moveDown', {
                    defaultValue: 'Move {{column}} down',
                    column: column.id,
                  })}
                  disabled={index === columns.length - 1}
                  className="h-6 w-6 text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  onClick={() => handleMoveColumn(column.id, 1)}
                >
                  ↓
                </Button>
                <Button
                  id={`designer-remove-column-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={t('invoiceDesigner.tableEditor.columns.remove', {
                    defaultValue: 'Remove {{column}}',
                    column: column.id,
                  })}
                  className="h-6 w-6 text-slate-400 hover:text-destructive hover:bg-destructive/10"
                  onClick={() => handleRemoveColumn(column.id)}
                >
                  ×
                </Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
                {t('invoiceDesigner.tableEditor.columns.header', { defaultValue: 'Header' })}
              </label>
              <Input
                id={`column-header-${column.id}`}
                size="sm"
                containerClassName="w-full"
                value={column.header ?? ''}
                onChange={(event) => updateColumn(column.id, { header: event.target.value }, false)}
                onBlur={(event) => updateColumn(column.id, { header: event.target.value }, true)}
                placeholder={t('invoiceDesigner.tableEditor.columns.headerPlaceholder', { defaultValue: 'Header label' })}
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
                {t('invoiceDesigner.tableEditor.columns.bindingKey', { defaultValue: 'Binding key' })}
              </label>
              <Input
                id={`column-key-${column.id}`}
                size="sm"
                containerClassName="w-full"
                value={column.key ?? ''}
                onChange={(event) => updateColumn(column.id, { key: event.target.value }, false)}
                onBlur={(event) => updateColumn(column.id, { key: event.target.value }, true)}
                placeholder="item.field"
                className="text-xs font-mono"
              />
              {bindingKeySuggestions.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {bindingKeySuggestions.slice(0, 8).map((suggestion) => (
                    <button
                      key={`${column.id}-${suggestion}`}
                      type="button"
                      className="rounded border border-slate-200 dark:border-[rgb(var(--color-border-200))] bg-slate-50 dark:bg-[rgb(var(--color-background))] px-1.5 py-0.5 text-[10px] text-slate-600 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      onClick={() => updateColumn(column.id, { key: suggestion }, true)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-1.5">
              <div>
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('invoiceDesigner.tableEditor.columns.type', { defaultValue: 'Type' })}
                </label>
                <CustomSelect
                  id={`column-type-${column.id}`}
                  options={[
                    { value: 'text', label: t('invoiceDesigner.tableEditor.columnTypes.text', { defaultValue: 'Text' }) },
                    { value: 'number', label: t('invoiceDesigner.tableEditor.columnTypes.number', { defaultValue: 'Number' }) },
                    { value: 'currency', label: t('invoiceDesigner.tableEditor.columnTypes.currency', { defaultValue: 'Currency' }) },
                    { value: 'date', label: t('invoiceDesigner.tableEditor.columnTypes.date', { defaultValue: 'Date' }) },
                  ]}
                  value={column.type ?? 'text'}
                  onValueChange={(value: string) => updateColumn(column.id, { type: value }, true)}
                  size="sm"
                />
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 dark:text-slate-400 block mb-0.5">
                  {t('invoiceDesigner.tableEditor.columns.width', { defaultValue: 'Width' })}
                </label>
                <Input
                  id={`column-width-${column.id}`}
                  size="sm"
                  containerClassName="w-full"
                  type="number"
                  value={typeof column.width === 'number' && Number.isFinite(column.width) ? column.width : 120}
                  onChange={(event) => updateColumn(column.id, { width: Number(event.target.value) }, false)}
                  onBlur={(event) => updateColumn(column.id, { width: Number(event.target.value) }, true)}
                  className="text-xs tabular-nums"
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Collapsible key reference */}
      <details className="text-[11px]">
        <summary className="text-slate-500 dark:text-slate-400 cursor-pointer select-none hover:text-slate-700 dark:hover:text-slate-300 py-1">
          {t('invoiceDesigner.tableEditor.reference.title', { defaultValue: 'Field key reference' })}
        </summary>
        <div className="mt-1 space-y-0.5">
          {bindingKeySuggestions.map((suggestion) => (
            <div
              key={`binding-${suggestion}`}
              className="flex items-center justify-between rounded px-2 py-0.5 bg-slate-50 dark:bg-[rgb(var(--color-background))]"
            >
              <code className="text-[11px] text-slate-600 dark:text-slate-400">{suggestion}</code>
              <span className="text-[10px] text-slate-400 dark:text-slate-500">
                {suggestion.startsWith('item.aggregates.')
                  ? t('invoiceDesigner.tableEditor.reference.transformAggregate', { defaultValue: 'Transform aggregate' })
                  : suggestion === 'item.key'
                    ? t('invoiceDesigner.tableEditor.reference.groupedRowKey', { defaultValue: 'Grouped row key' })
                    : suggestion === 'item.items'
                      ? t('invoiceDesigner.tableEditor.reference.groupedRowItems', { defaultValue: 'Grouped row items' })
                      : t('invoiceDesigner.tableEditor.reference.availableBinding', { defaultValue: 'Available binding' })}
              </span>
            </div>
          ))}
          {!isGroupedTransformsOutput &&
            columnPresets.map((preset) => (
              <div key={`legend-${preset.id}`} className="flex items-center justify-between rounded px-2 py-0.5 bg-slate-50 dark:bg-[rgb(var(--color-background))]">
                <code className="text-[11px] text-slate-600 dark:text-slate-400">{preset.key}</code>
                <span className="text-[10px] text-slate-400 dark:text-slate-500">{preset.description}</span>
              </div>
            ))}
        </div>
      </details>
    </div>
  );
};
