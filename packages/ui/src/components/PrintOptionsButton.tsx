'use client';

import * as React from 'react';
import { Settings2 } from 'lucide-react';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './DropdownMenu';
import type { PrintableTableColumn } from './PrintableTable';
import { useTranslation } from '../lib/i18n/client';
import type { ColumnDefinition } from '@alga-psa/types';

export type PrintColumnOption<T> = PrintableTableColumn<T> & {
  label: React.ReactNode;
  defaultVisible?: boolean;
};

type PrintColumnRendererMap<T> = Record<string, (record: T) => React.ReactNode>;

type CreatePrintColumnsFromColumnDefinitionsOptions<T> = {
  excludeColumnKeys?: string[];
  renderers?: PrintColumnRendererMap<T>;
  emptyValue?: React.ReactNode;
};

type PrintOptionsButtonProps<T> = {
  id: string;
  columns: PrintColumnOption<T>[];
  selectedColumnKeys: string[];
  onSelectedColumnKeysChange: (keys: string[]) => void;
  onReset?: () => void;
};

export function getDefaultPrintColumnKeys<T>(columns: PrintColumnOption<T>[]): string[] {
  const defaults = columns
    .filter((column) => column.defaultVisible !== false)
    .map((column) => column.key);

  return defaults.length > 0 ? defaults : columns.slice(0, 1).map((column) => column.key);
}

function getColumnDataIndexKey(dataIndex: string | string[]): string {
  return Array.isArray(dataIndex) ? dataIndex.join('.') : dataIndex;
}

function getNestedColumnValue<T>(record: T, dataIndex: string | string[]): unknown {
  const path = Array.isArray(dataIndex) ? dataIndex : [dataIndex];
  return path.reduce<unknown>((value, key) => (
    value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  ), record);
}

function formatDefaultPrintValue(value: unknown, emptyValue: React.ReactNode): React.ReactNode {
  if (value === null || value === undefined || value === '') return emptyValue;
  if (value instanceof Date) return value.toLocaleString();
  if (Array.isArray(value)) return value.filter(Boolean).join(', ') || emptyValue;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function createPrintColumnsFromColumnDefinitions<T>(
  columns: ColumnDefinition<T>[],
  options: CreatePrintColumnsFromColumnDefinitionsOptions<T> = {}
): PrintColumnOption<T>[] {
  const excludeColumnKeys = new Set(options.excludeColumnKeys ?? []);
  const renderers = options.renderers ?? {};
  const emptyValue = options.emptyValue ?? '-';
  const keyCounts = new Map<string, number>();

  return columns.flatMap((column) => {
    const baseKey = getColumnDataIndexKey(column.dataIndex);
    if (excludeColumnKeys.has(baseKey)) {
      return [];
    }

    const nextCount = (keyCounts.get(baseKey) ?? 0) + 1;
    keyCounts.set(baseKey, nextCount);
    const key = nextCount === 1 ? baseKey : `${baseKey}-${nextCount}`;
    const renderer = renderers[key] ?? renderers[baseKey];

    return [{
      key,
      label: column.title,
      header: column.title,
      render: renderer ?? ((record) => formatDefaultPrintValue(
        getNestedColumnValue(record, column.dataIndex),
        emptyValue
      )),
    }];
  });
}

export function usePrintColumnSelection<T>(
  storageKey: string,
  columns: PrintColumnOption<T>[]
) {
  const defaultKeys = React.useMemo(() => getDefaultPrintColumnKeys(columns), [columns]);
  const availableKeys = React.useMemo(() => new Set(columns.map((column) => column.key)), [columns]);

  const [selectedColumnKeys, setSelectedColumnKeys] = React.useState<string[]>(defaultKeys);

  React.useEffect(() => {
    if (typeof window === 'undefined') {
      setSelectedColumnKeys(defaultKeys);
      return;
    }

    try {
      const storedValue = window.localStorage.getItem(storageKey);
      const parsedValue = storedValue ? JSON.parse(storedValue) : null;
      const storedKeys = Array.isArray(parsedValue)
        ? parsedValue.filter((key): key is string => typeof key === 'string' && availableKeys.has(key))
        : [];

      setSelectedColumnKeys(storedKeys.length > 0 ? storedKeys : defaultKeys);
    } catch {
      setSelectedColumnKeys(defaultKeys);
    }
  }, [availableKeys, defaultKeys, storageKey]);

  const updateSelectedColumnKeys = React.useCallback((keys: string[]) => {
    const nextKeys = keys.filter((key) => availableKeys.has(key));
    const normalizedKeys = nextKeys.length > 0 ? nextKeys : defaultKeys;
    setSelectedColumnKeys(normalizedKeys);

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(normalizedKeys));
    }
  }, [availableKeys, defaultKeys, storageKey]);

  const resetSelectedColumnKeys = React.useCallback(() => {
    setSelectedColumnKeys(defaultKeys);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(storageKey);
    }
  }, [defaultKeys, storageKey]);

  const selectedColumns = React.useMemo(() => {
    const selectedKeySet = new Set(selectedColumnKeys);
    const nextColumns = columns.filter((column) => selectedKeySet.has(column.key));
    return nextColumns.length > 0 ? nextColumns : columns.slice(0, 1);
  }, [columns, selectedColumnKeys]);

  return {
    selectedColumnKeys,
    selectedColumns,
    setSelectedColumnKeys: updateSelectedColumnKeys,
    resetSelectedColumnKeys,
  };
}

export function PrintOptionsButton<T>({
  id,
  columns,
  selectedColumnKeys,
  onSelectedColumnKeysChange,
  onReset,
}: PrintOptionsButtonProps<T>) {
  const { t } = useTranslation('common');
  const selectedKeySet = React.useMemo(() => new Set(selectedColumnKeys), [selectedColumnKeys]);

  const toggleColumn = (columnKey: string) => {
    const nextKeys = selectedKeySet.has(columnKey)
      ? selectedColumnKeys.filter((key) => key !== columnKey)
      : [...selectedColumnKeys, columnKey];

    onSelectedColumnKeysChange(nextKeys);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <Settings2 className="h-4 w-4" />
          {t('actions.printOptions', { defaultValue: 'Print options' })}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {t('labels.printColumns', { defaultValue: 'Print columns' })}
        </DropdownMenuLabel>
        <div className="max-h-72 overflow-y-auto px-1 py-1">
          {columns.map((column) => (
            <div key={column.key} className="px-2 py-1">
              <Checkbox
                id={`${id}-${column.key}`}
                label={column.label}
                checked={selectedKeySet.has(column.key)}
                onChange={() => toggleColumn(column.key)}
                containerClassName="mb-0"
                skipRegistration
              />
            </div>
          ))}
        </div>
        <DropdownMenuSeparator />
        <div className="p-1">
          <Button
            id={`${id}-reset`}
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={onReset}
          >
            {t('actions.resetPrintOptions', { defaultValue: 'Reset print options' })}
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
