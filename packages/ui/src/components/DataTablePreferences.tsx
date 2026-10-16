'use client';

import React, { createContext, useCallback, useContext, useMemo } from 'react';

export const DATA_TABLE_PAGE_SIZES_PREFERENCE_KEY = 'dataTable.pageSizes';
export type DataTablePageSizes = Record<string, number>;

interface DataTablePreferencesValue {
  pageSizes: DataTablePageSizes;
  hasLoaded: boolean;
  savePageSize: (tableKey: string, pageSize: number) => void;
}

const DataTablePreferencesContext = createContext<DataTablePreferencesValue | null>(null);

export function DataTablePreferencesProvider({
  children,
  pageSizes,
  hasLoaded = true,
  onPageSizesChange,
}: {
  children: React.ReactNode;
  pageSizes: DataTablePageSizes;
  hasLoaded?: boolean;
  onPageSizesChange: (pageSizes: DataTablePageSizes | ((previous: DataTablePageSizes) => DataTablePageSizes)) => void;
}) {
  const savePageSize = React.useCallback((tableKey: string, pageSize: number) => {
    onPageSizesChange(previous => ({ ...previous, [tableKey]: pageSize }));
  }, [onPageSizesChange]);
  const value = useMemo(() => ({ pageSizes, hasLoaded, savePageSize }), [pageSizes, hasLoaded, savePageSize]);
  return <DataTablePreferencesContext.Provider value={value}>{children}</DataTablePreferencesContext.Provider>;
}

export function useDataTablePageSizePreference(tableKey?: string) {
  const context = useContext(DataTablePreferencesContext);
  const savePageSize = useCallback((pageSize: number) => {
    if (tableKey && context) context.savePageSize(tableKey, pageSize);
  }, [context, tableKey]);
  return {
    pageSize: tableKey ? context?.pageSizes[tableKey] : undefined,
    hasLoaded: context?.hasLoaded ?? true,
    savePageSize,
    enabled: !!tableKey && !!context,
  };
}
