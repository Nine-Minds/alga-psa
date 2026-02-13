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
};

type BorderPreset = 'list' | 'boxed' | 'grid' | 'none' | 'custom';

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
      setNodeProp(node.id, 'metadata.columns', next, commit);
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

  const handleAddColumn = useCallback(() => {
    updateColumns(
      [
        ...columns,
        {
          id: createLocalId(),
          header: 'New Column',
          key: 'data.field',
          type: 'text',
          width: 120,
        },
      ],
      true
    );
  }, [columns, updateColumns]);

  const handleRemoveColumn = useCallback(
    (columnId: string) => updateColumns(columns.filter((column) => column.id !== columnId), true),
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
        <span>Table Columns</span>
        <Button id="designer-add-column" variant="outline" size="xs" onClick={handleAddColumn}>
          Add column
        </Button>
      </div>

      <div className="rounded border border-slate-100 bg-slate-50 px-2 py-2 space-y-1 text-xs text-slate-600">
        <p className="font-semibold text-slate-700">Borders</p>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Preset</label>
          <select
            id="designer-table-border-preset"
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
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
        <label className="flex items-center gap-2">
          <input
            id="designer-table-border-outer"
            type="checkbox"
            checked={tableBorderConfig.outer}
            onChange={(event) => {
              setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
              setNodeProp(node.id, 'metadata.tableOuterBorder', event.target.checked, true);
            }}
          />
          Outer border
        </label>
        <label className="flex items-center gap-2">
          <input
            id="designer-table-border-rows"
            type="checkbox"
            checked={tableBorderConfig.rowDividers}
            onChange={(event) => {
              setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
              setNodeProp(node.id, 'metadata.tableRowDividers', event.target.checked, true);
            }}
          />
          Row dividers
        </label>
        <label className="flex items-center gap-2">
          <input
            id="designer-table-border-columns"
            type="checkbox"
            checked={tableBorderConfig.columnDividers}
            onChange={(event) => {
              setNodeProp(node.id, 'metadata.tableBorderPreset', 'custom', false);
              setNodeProp(node.id, 'metadata.tableColumnDividers', event.target.checked, true);
            }}
          />
          Column dividers
        </label>
        <div>
          <label className="text-xs text-slate-500 block mb-1">Header weight</label>
          <select
            id="designer-table-header-weight"
            className="w-full border border-slate-300 rounded-md px-2 py-1 text-sm"
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

      {columns.length === 0 && <p className="text-xs text-slate-500">No columns defined. Add at least one column.</p>}

      {columns.map((column) => (
        <div key={column.id} className="border border-slate-100 rounded-md p-2 space-y-2 bg-slate-50">
          <div className="flex items-center justify-between">
            <Input
              id={`column-header-${column.id}`}
              value={column.header ?? ''}
              onChange={(event) => updateColumn(column.id, { header: event.target.value }, false)}
              onBlur={(event) => updateColumn(column.id, { header: event.target.value }, true)}
              className="text-xs"
            />
            <Button
              id={`designer-remove-column-${column.id}`}
              variant="ghost"
              size="icon"
              onClick={() => handleRemoveColumn(column.id)}
            >
              ✕
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
              <label className="block mb-1">Binding key</label>
              <Input
                id={`column-key-${column.id}`}
                value={column.key ?? ''}
                onChange={(event) => updateColumn(column.id, { key: event.target.value }, false)}
                onBlur={(event) => updateColumn(column.id, { key: event.target.value }, true)}
                className="text-xs"
              />
            </div>
            <div>
              <label className="block mb-1">Type</label>
              <select
                className="w-full border border-slate-300 rounded-md px-2 py-1 text-xs"
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
              <label className="block mb-1">Width (px)</label>
              <Input
                id={`column-width-${column.id}`}
                type="number"
                value={typeof column.width === 'number' && Number.isFinite(column.width) ? column.width : 120}
                onChange={(event) => updateColumn(column.id, { width: Number(event.target.value) }, false)}
                onBlur={(event) => updateColumn(column.id, { width: Number(event.target.value) }, true)}
                className="text-xs"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

