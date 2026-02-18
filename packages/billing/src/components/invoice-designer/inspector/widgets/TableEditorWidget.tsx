import React, { useCallback, useMemo } from 'react';
import { Button } from '@alga-psa/ui/components/Button';
import { Input } from '@alga-psa/ui/components/Input';
import type { DesignerNode } from '../../state/designerStore';
import { useInvoiceDesignerStore } from '../../state/designerStore';
import { getNodeMetadata } from '../../utils/nodeProps';

const createLocalId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);

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

const COLUMN_PRESETS: ColumnPreset[] = [
  {
    id: 'description',
    label: 'Description',
    header: 'Description',
    key: 'item.description',
    type: 'text',
    width: 280,
    description: 'Line item description',
  },
  {
    id: 'quantity',
    label: 'Qty',
    header: 'Qty',
    key: 'item.quantity',
    type: 'number',
    width: 90,
    description: 'Quantity',
  },
  {
    id: 'unit-price',
    label: 'Rate',
    header: 'Rate',
    key: 'item.unitPrice',
    type: 'currency',
    width: 120,
    description: 'Unit price',
  },
  {
    id: 'amount',
    label: 'Amount',
    header: 'Amount',
    key: 'item.total',
    type: 'currency',
    width: 140,
    description: 'Line total',
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

export const TableEditorWidget: React.FC<Props> = ({ node }) => {
  const setNodeProp = useInvoiceDesignerStore((state) => state.setNodeProp);

  const metadata = useMemo(() => getNodeMetadata(node), [node]);

  const columns: ColumnModel[] = useMemo(() => {
    const raw = (metadata as { columns?: unknown }).columns;
    return Array.isArray(raw) ? (raw as ColumnModel[]).filter((col) => typeof col?.id === 'string') : [];
  }, [metadata]);

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
      header: 'New Column',
      key: 'item.field',
      type: 'text',
      width: 120,
    });
  }, [appendColumn]);

  const handleAddPresetColumn = useCallback(
    (presetId: string) => {
      const preset = COLUMN_PRESETS.find((candidate) => candidate.id === presetId);
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
    [appendColumn]
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

  const panelClass = 'rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm space-y-2';

  return (
    <div className="space-y-3">
      {/* Header with quick-add */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">Table Columns</p>
          <Button id="designer-add-column" variant="outline" size="xs" onClick={handleAddColumn}>
            + Column
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-slate-400 shrink-0">Quick add:</span>
          {COLUMN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              id={`designer-add-column-preset-${preset.id}`}
              type="button"
              className="inline-flex h-6 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:border-slate-300 transition-colors"
              onClick={() => handleAddPresetColumn(preset.id)}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table style */}
      <div className={panelClass}>
        <p className="text-xs font-semibold text-slate-700">Table Style</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Border preset</label>
            <select
              id="designer-table-border-preset"
              className="h-8 w-full border border-slate-200 rounded-md px-2 text-xs bg-white"
              value={resolvedBorderPreset}
              onChange={(event) => applyTableBorderPreset(event.target.value as BorderPreset)}
            >
              <option value="list">List</option>
              <option value="boxed">Boxed</option>
              <option value="grid">Grid</option>
              <option value="none">None</option>
              <option value="custom">Custom</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Header weight</label>
            <select
              id="designer-table-header-weight"
              className="h-8 w-full border border-slate-200 rounded-md px-2 text-xs bg-white"
              value={resolvedHeaderWeight}
              onChange={(event) => setNodeProp(node.id, 'metadata.tableHeaderFontWeight', event.target.value, true)}
            >
              <option value="normal">Normal</option>
              <option value="medium">Medium</option>
              <option value="semibold">Semibold</option>
              <option value="bold">Bold</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
            <input
              id="designer-table-border-outer"
              type="checkbox"
              className="rounded border-slate-300"
              checked={tableBorderConfig.outer}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableOuterBorder', event.target.checked, true);
              }}
            />
            Outer
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
            <input
              id="designer-table-border-rows"
              type="checkbox"
              className="rounded border-slate-300"
              checked={tableBorderConfig.rowDividers}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableRowDividers', event.target.checked, true);
              }}
            />
            Rows
          </label>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer">
            <input
              id="designer-table-border-columns"
              type="checkbox"
              className="rounded border-slate-300"
              checked={tableBorderConfig.columnDividers}
              onChange={(event) => {
                setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
                setNodeProp(node.id, 'metadata.tableColumnDividers', event.target.checked, true);
              }}
            />
            Columns
          </label>
        </div>
      </div>

      {/* Column list */}
      {columns.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">
          No columns defined. Add at least one column.
        </div>
      )}

      <div className="space-y-2">
        {columns.map((column, index) => (
          <div key={column.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="inline-flex items-center gap-1.5">
                <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-slate-100 text-[10px] font-medium text-slate-500 tabular-nums shrink-0">
                  {index + 1}
                </span>
                <span className="text-[11px] font-medium text-slate-500">Column</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  id={`designer-move-column-up-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={`Move ${column.id} up`}
                  disabled={index === 0}
                  className="h-6 w-6 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  onClick={() => handleMoveColumn(column.id, -1)}
                >
                  ↑
                </Button>
                <Button
                  id={`designer-move-column-down-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={`Move ${column.id} down`}
                  disabled={index === columns.length - 1}
                  className="h-6 w-6 text-slate-400 hover:text-slate-600 hover:bg-slate-50"
                  onClick={() => handleMoveColumn(column.id, 1)}
                >
                  ↓
                </Button>
                <Button
                  id={`designer-remove-column-${column.id}`}
                  variant="outline"
                  size="icon"
                  aria-label={`Remove ${column.id}`}
                  className="h-6 w-6 text-slate-400 hover:text-red-500 hover:bg-red-50"
                  onClick={() => handleRemoveColumn(column.id)}
                >
                  ×
                </Button>
              </div>
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Header</label>
              <Input
                id={`column-header-${column.id}`}
                size="sm"
                containerClassName="w-full"
                value={column.header ?? ''}
                onChange={(event) => updateColumn(column.id, { header: event.target.value }, false)}
                onBlur={(event) => updateColumn(column.id, { header: event.target.value }, true)}
                placeholder="Header label"
                className="text-xs"
              />
            </div>
            <div>
              <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Binding key</label>
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
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-1.5">
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Type</label>
                <select
                  className="h-8 w-full border border-slate-200 rounded-md px-1.5 text-xs bg-white"
                  value={column.type ?? 'text'}
                  onChange={(event) => updateColumn(column.id, { type: event.target.value }, true)}
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="currency">Currency</option>
                  <option value="date">Date</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-slate-500 block mb-0.5">Width</label>
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
        <summary className="text-slate-500 cursor-pointer select-none hover:text-slate-700 py-1">
          Field key reference
        </summary>
        <div className="mt-1 space-y-0.5">
          {COLUMN_PRESETS.map((preset) => (
            <div key={`legend-${preset.id}`} className="flex items-center justify-between rounded px-2 py-0.5 bg-slate-50">
              <code className="text-[11px] text-slate-600">{preset.key}</code>
              <span className="text-[10px] text-slate-400">{preset.description}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};
