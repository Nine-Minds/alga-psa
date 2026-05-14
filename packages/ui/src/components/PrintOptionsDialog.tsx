'use client';

import * as React from 'react';
import { Printer } from 'lucide-react';
import { Button } from './Button';
import { Checkbox } from './Checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
} from './Dialog';
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

type PrintOptionsDialogProps<T> = {
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  columns: PrintColumnOption<T>[];
  selectedColumnKeys: string[];
  onSelectedColumnKeysChange: (keys: string[]) => void;
  onReset?: () => void;
  /** When provided, footer shows a primary Print button that calls this and closes the dialog. */
  onPrint?: () => void | Promise<void>;
  printLabel?: string;
  isPrinting?: boolean;
  title?: string;
  description?: React.ReactNode;
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
  const columnKeysSignature = columns.map((column) => column.key).join('|');

  const defaultKeys = React.useMemo(
    () => getDefaultPrintColumnKeys(columns),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnKeysSignature]
  );
  const availableKeys = React.useMemo(
    () => new Set(columns.map((column) => column.key)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnKeysSignature]
  );

  const [selectedColumnKeys, setSelectedColumnKeys] = React.useState<string[]>(defaultKeys);

  React.useEffect(() => {
    const computeNextKeys = (): string[] => {
      if (typeof window === 'undefined') return defaultKeys;
      try {
        const storedValue = window.localStorage.getItem(storageKey);
        const parsedValue = storedValue ? JSON.parse(storedValue) : null;
        const storedKeys = Array.isArray(parsedValue)
          ? parsedValue.filter((key): key is string => typeof key === 'string' && availableKeys.has(key))
          : [];
        return storedKeys.length > 0 ? storedKeys : defaultKeys;
      } catch {
        return defaultKeys;
      }
    };

    const nextKeys = computeNextKeys();
    setSelectedColumnKeys((prev) =>
      prev.length === nextKeys.length && prev.every((key, i) => key === nextKeys[i])
        ? prev
        : nextKeys
    );
  }, [availableKeys, defaultKeys, storageKey]);

  const updateSelectedColumnKeys = React.useCallback((keys: string[]) => {
    const nextKeys = keys.filter((key) => availableKeys.has(key));
    const normalizedKeys = nextKeys.length > 0 ? nextKeys : defaultKeys;
    setSelectedColumnKeys((prev) =>
      prev.length === normalizedKeys.length && prev.every((key, i) => key === normalizedKeys[i])
        ? prev
        : normalizedKeys
    );

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(normalizedKeys));
    }
  }, [availableKeys, defaultKeys, storageKey]);

  const resetSelectedColumnKeys = React.useCallback(() => {
    setSelectedColumnKeys((prev) =>
      prev.length === defaultKeys.length && prev.every((key, i) => key === defaultKeys[i])
        ? prev
        : defaultKeys
    );
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

export function PrintOptionsDialog<T>({
  id,
  open,
  onOpenChange,
  columns,
  selectedColumnKeys,
  onSelectedColumnKeysChange,
  onReset,
  onPrint,
  printLabel,
  isPrinting,
  title,
  description,
}: PrintOptionsDialogProps<T>) {
  const { t } = useTranslation('common');
  const selectedKeySet = React.useMemo(() => new Set(selectedColumnKeys), [selectedColumnKeys]);
  const dialogTitle = title ?? t('actions.printOptions', { defaultValue: 'Print options' });

  const toggleColumn = (columnKey: string) => {
    const nextKeys = selectedKeySet.has(columnKey)
      ? selectedColumnKeys.filter((key) => key !== columnKey)
      : [...selectedColumnKeys, columnKey];

    onSelectedColumnKeysChange(nextKeys);
  };

  const handlePrint = async () => {
    if (!onPrint) return;
    onOpenChange(false);
    await onPrint();
  };

  return (
    <Dialog
      id={id}
      isOpen={open}
      onClose={() => onOpenChange(false)}
      title={dialogTitle}
      className="max-w-md"
    >
      <DialogContent>
        {description ? (
          <DialogDescription>{description}</DialogDescription>
        ) : (
          <DialogDescription className="sr-only">
            {t('labels.printColumns', { defaultValue: 'Print columns' })}
          </DialogDescription>
        )}
        <div className="max-h-[60vh] overflow-y-auto -mx-2 px-2">
          {columns.map((column) => (
            <div key={column.key} className="py-1">
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
        <DialogFooter className="justify-between">
          <Button
            id={`${id}-reset`}
            variant="ghost"
            size="sm"
            onClick={onReset}
            disabled={!onReset}
          >
            {t('actions.resetPrintOptions', { defaultValue: 'Reset print options' })}
          </Button>
          {onPrint ? (
            <Button
              id={`${id}-print`}
              variant="default"
              size="sm"
              onClick={() => { void handlePrint(); }}
              disabled={isPrinting}
              className="gap-2"
            >
              <Printer className="h-4 w-4" />
              {printLabel ?? t('actions.print', { defaultValue: 'Print' })}
            </Button>
          ) : (
            <Button
              id={`${id}-done`}
              variant="default"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t('actions.done', { defaultValue: 'Done' })}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
