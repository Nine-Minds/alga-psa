'use client'; // Added directive

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import { DataTableComponent, AutomationProps, TextComponent } from 'server/src/types/ui-reflection/types';
import { useRegisterChild } from 'server/src/types/ui-reflection/useRegisterChild';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  Row,
  SortingFn,
  SortingState,
} from '@tanstack/react-table';
import { ColumnDefinition, DataTableProps } from 'server/src/interfaces/dataTable.interfaces';
import { ReflectionContainer } from 'server/src/types/ui-reflection/ReflectionContainer';

// Helper function to get nested property value
const getNestedValue = (obj: unknown, path: string | string[]): unknown => {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }

  // If path is a string and doesn't contain dots, access directly
  if (typeof path === 'string' && !path.includes('.')) {
    return (obj as Record<string, unknown>)[path];
  }

  // For dot notation or array paths
  const keys = Array.isArray(path) ? path : path.split('.');
  return keys.reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

// Helper function to extract display text from column render function
const getDisplayText = (columnDef: ColumnDefinition<any> | undefined, cellValue: unknown, rowData: any): string => {
  if (!columnDef || !columnDef.render) {
    // No custom render, use the raw value
    return typeof cellValue === 'string' ? cellValue : String(cellValue || '');
  }

  // For columns with render functions, simulate what the render would show
  const renderResult = columnDef.render(cellValue, rowData, 0);
  
  // If render returns a string, use it directly
  if (typeof renderResult === 'string') {
    return renderResult;
  }
  
  // For JSX elements, try to extract text content based on common patterns
  if (React.isValidElement(renderResult)) {
    // Handle common patterns in the codebase
    if (renderResult.props && renderResult.props.children) {
      const children = renderResult.props.children;
      if (typeof children === 'string') {
        return children;
      }
      // Handle nested text content
      if (Array.isArray(children)) {
        return children.filter(child => typeof child === 'string').join(' ');
      }
    }
  }
  
  // Fallback: use the original value with N/A handling
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return 'N/A';
  }
  
  return String(cellValue);
};

// Custom case-insensitive sorting function for all columns
const caseInsensitiveSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);
  return String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase());
};

// Component to register table cell content with UI reflection system
interface ReflectedTableCellProps {
  id: string;
  content: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const ReflectedTableCell: React.FC<ReflectedTableCellProps> = ({ 
  id, 
  content, 
  children, 
  className, 
  style 
}) => {
  // Register the cell with UI reflection system
  const updateCellMetadata = id ? useRegisterChild<TextComponent>({
    id,
    type: 'text',
    text: content
  }) : undefined;
  
  // Only update metadata when content changes
  useEffect(() => {
    if (updateCellMetadata && content) {
      updateCellMetadata({ text: content });
    }
  }, [content, updateCellMetadata]);
  
  return (
    <td
      className={className}
      style={style}
      data-automation-id={id}
    >
      <div className="break-words min-w-0 [&_button:not(.whitespace-normal)]:whitespace-nowrap [&_a:not(.whitespace-normal)]:whitespace-nowrap">
        {children}
      </div>
    </td>
  );
};

export interface ExtendedDataTableProps<T extends object> extends DataTableProps<T> {
  /** Unique identifier for UI reflection system */
  id?: string;
}

export const DataTable = <T extends object>(props: ExtendedDataTableProps<T>): React.ReactElement => {
  const {
    id,
    data,
    columns,
    pagination = true,
    onRowClick,
    currentPage = 1,
    onPageChange,
    pageSize = 10,
    totalItems,
    editableConfig,
    manualSorting = false,
    sortBy,
    sortDirection,
    onSortChange
  } = props;
  
  // Reference to the table container for measuring available width
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  // State to track which columns should be visible
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    columns.map(col => Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex)
  );
  
  // Function to calculate which columns should be visible based on available width
  const updateVisibleColumns = () => {
    if (!tableContainerRef.current) return;
    
    const containerWidth = tableContainerRef.current.clientWidth;
    const minColumnWidth = 120; // Reduced minimum width to show more columns with multiline content
    
    // Check if the last column is 'Actions' or 'Action' with interactive elements
    const lastColumnIndex = columns.length - 1;
    const lastColumn = columns[lastColumnIndex];
    const isActionsColumn = lastColumn && 
      (lastColumn.title === 'Actions' || lastColumn.title === 'Action') && 
      lastColumn.render !== undefined;
    
    const prioritizedColumns = [...columns].sort((a, b) => {
      // Always prioritize Actions column if it's the last column
      if (isActionsColumn) {
        if (a === lastColumn) return -1;
        if (b === lastColumn) return 1;
      }
      
      // Keep ID column and any columns with explicit width as highest priority
      const aIsId = Array.isArray(a.dataIndex) ? a.dataIndex.includes('id') : a.dataIndex === 'id';
      const bIsId = Array.isArray(b.dataIndex) ? b.dataIndex.includes('id') : b.dataIndex === 'id';
      
      if (aIsId && !bIsId) return -1;
      if (!aIsId && bIsId) return 1;
      
      // Then prioritize columns with explicit width
      if (a.width && !b.width) return -1;
      if (!a.width && b.width) return 1;
      
      return 0;
    });
    
    // Calculate how many columns we can fit
    const maxColumns = Math.max(1, Math.floor(containerWidth / minColumnWidth));
    
    // Get the IDs of columns that should be visible
    const newVisibleColumnIds = prioritizedColumns
      .slice(0, maxColumns)
      .map(col => Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex);
    
    setVisibleColumnIds(newVisibleColumnIds);
  };
  
  // Add resize event listener
  useEffect(() => {
    // Define updateVisibleColumns inside the effect to properly capture the columns dependency
    const updateVisibleColumnsEffect = () => {
      if (!tableContainerRef.current) return;
      
      const containerWidth = tableContainerRef.current.clientWidth;
      const minColumnWidth = 120; // Reduced minimum width to show more columns with multiline content
      
      // Check if the last column is 'Actions' or 'Action' with interactive elements
      const lastColumnIndex = columns.length - 1;
      const lastColumn = columns[lastColumnIndex];
      const isActionsColumn = lastColumn && 
        (lastColumn.title === 'Actions' || lastColumn.title === 'Action') && 
        lastColumn.render !== undefined;
      
      const prioritizedColumns = [...columns].sort((a, b) => {
        // Always prioritize Actions column if it's the last column
        if (isActionsColumn) {
          if (a === lastColumn) return -1;
          if (b === lastColumn) return 1;
        }
        
        // Keep ID column and any columns with explicit width as highest priority
        const aIsId = Array.isArray(a.dataIndex) ? a.dataIndex.includes('id') : a.dataIndex === 'id';
        const bIsId = Array.isArray(b.dataIndex) ? b.dataIndex.includes('id') : b.dataIndex === 'id';
        
        if (aIsId && !bIsId) return -1;
        if (!aIsId && bIsId) return 1;
        
        // Then prioritize columns with explicit width
        if (a.width && !b.width) return -1;
        if (!a.width && b.width) return 1;
        
        return 0;
      });
      
      // Calculate how many columns we can fit
      const maxColumns = Math.max(1, Math.floor(containerWidth / minColumnWidth));
      
      // Get the IDs of columns that should be visible
      const newVisibleColumnIds = prioritizedColumns
        .slice(0, maxColumns)
        .map(col => Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex);
      
      setVisibleColumnIds(newVisibleColumnIds);
    };
    
    updateVisibleColumnsEffect();
    
    const handleResize = () => {
      updateVisibleColumnsEffect();
    };
    
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [columns]); // Re-run when columns change

  // Memoize the initial column configuration to prevent loops
  const columnConfig = useMemo(() => {
    return columns.map((col): { id: string; title: string; dataIndex: string | string[]; hasCustomRender: boolean; visible: boolean } => {
      const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
      return {
        id: colId,
        title: String(col.title), // Convert ReactNode to string
        dataIndex: col.dataIndex,
        hasCustomRender: !!col.render,
        visible: visibleColumnIds.includes(colId)
      };
    });
  }, [columns, visibleColumnIds]);

  // Register with UI reflection system with stable references
  const updateMetadata = id ? useRegisterUIComponent<DataTableComponent>({
    id: `${id}-table`,
    type: 'dataTable',
    columns: columnConfig,
    pagination: {
      enabled: pagination,
      currentPage,
      pageSize,
      totalItems: totalItems ?? data.length,
      totalPages: Math.ceil((totalItems ?? data.length) / pageSize)
    },
    rowCount: data.length,
    visibleRows: data.slice(0, pageSize).map((row): { id: string; values: Record<string, unknown> } => ({
      id: ('id' in row) ? (row as { id: string }).id : '',
      values: row as Record<string, unknown>
    })),
    isEditable: !!editableConfig
  }) : undefined;

  // Create stable column definitions, filtering out columns that shouldn't be visible
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns
        .filter(col => {
          const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
          return visibleColumnIds.includes(colId);
        })
        .map((col): ColumnDef<T> => ({
          id: Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex,
          accessorFn: (row) => getNestedValue(row, col.dataIndex),
          header: () => col.title,
          cell: (info) => col.render ? col.render(info.getValue(), info.row.original, info.row.index) : info.getValue(),
          sortingFn: caseInsensitiveSort,
        })),
    [columns, visibleColumnIds]
  );

  // Keep internal pagination state synced with props
  React.useEffect(() => {
    setPagination(prev => ({
      ...prev,
      pageIndex: currentPage - 1
    }));
  }, [currentPage]);

  const [{ pageIndex, pageSize: currentPageSize }, setPagination] = React.useState({
    pageIndex: currentPage - 1,
    pageSize,
  });

  // Calculate total pages based on totalItems if provided, otherwise use data length
  const total = totalItems ?? data.length;
  const totalPages = Math.ceil(total / pageSize);

  // Manage sorting state
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (manualSorting && sortBy) {
      return [{
        id: sortBy,
        desc: sortDirection === 'desc'
      }];
    }
    return [];
  });

  // Update sorting state when props change (for manual sorting)
  React.useEffect(() => {
    if (manualSorting && sortBy) {
      setSorting([{
        id: sortBy,
        desc: sortDirection === 'desc'
      }]);
    }
  }, [manualSorting, sortBy, sortDirection]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    pageCount: totalPages,
    enableSortingRemoval: false,
    manualSorting,
    state: {
      pagination: {
        pageIndex,
        pageSize: currentPageSize,
      },
      sorting,
    },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      if (manualSorting && onSortChange) {
        const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
        if (newSorting.length > 0) {
          const { id, desc } = newSorting[0];
          onSortChange(id, desc ? 'desc' : 'asc');
        }
      } else {
        setSorting(updater);
      }
    },
    manualPagination: totalItems !== undefined,
    meta: {
      editableConfig: props.editableConfig,
    },
  });

  const handleRowClick = (row: Row<T>) => {
    if (onRowClick) {
      onRowClick(row.original);
    }
  };

  // Notify parent component of page changes
  React.useEffect(() => {
    if (onPageChange) {
      onPageChange(pageIndex + 1);
    }
  }, [pageIndex, onPageChange]);

  // Update reflection metadata with debouncing to prevent loops
  React.useEffect(() => {
    if (!updateMetadata) return;

    const timeoutId = setTimeout(() => {
      const paginationRowModel = table.getPaginationRowModel();
      const sortingState = table.getState().sorting;
      
      updateMetadata({
        pagination: {
          enabled: pagination,
          currentPage: pageIndex + 1,
          pageSize: currentPageSize,
          totalItems: totalItems ?? data.length,
          totalPages: Math.ceil((totalItems ?? data.length) / currentPageSize)
        },
        rowCount: data.length,
        visibleRows: paginationRowModel.rows.slice(0, 10).map((row): { id: string; values: Record<string, unknown> } => ({
          id: ('id' in row.original) ? (row.original as { id: string }).id : '',
          values: row.original as Record<string, unknown>
        })),
        sortedBy: sortingState[0] ? {
          column: sortingState[0].id,
          direction: sortingState[0].desc ? 'desc' : 'asc'
        } : undefined,
        columns: columnConfig
      });
    }, 100); // Debounce updates by 100ms

    return () => clearTimeout(timeoutId);
  }, [pageIndex, currentPageSize, data.length, totalItems, pagination, updateMetadata, columnConfig]);

  const handlePreviousPage = () => {
    table.previousPage();
  };

  const handleNextPage = () => {
    table.nextPage();
  };

  return (
    <div
      className="datatable-container overflow-hidden bg-white rounded-lg border border-gray-200"
      data-automation-id={id}
      ref={tableContainerRef}
    >
        {visibleColumnIds.length < columns.length && (
          <div className="px-4 py-2 bg-blue-50 text-blue-700 text-sm border-b border-gray-200">
            <span className="flex items-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {columns.length - visibleColumnIds.length} columns hidden due to limited space. Resize browser to see more.
            </span>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-white">
              {table.getHeaderGroups().map((headerGroup): JSX.Element => (
                <tr key={`headergroup_${headerGroup.id}`}>
                  {headerGroup.headers.map((header, headerIndex): JSX.Element => {
                    const columnId = header.column.columnDef.id || header.id;
                    return (
                    <th
                      key={`header_${columnId}_${headerIndex}`}
                      onClick={header.column.getToggleSortingHandler()}
                      className="px-6 py-3 text-left text-xs font-medium text-[rgb(var(--color-text-700))] tracking-wider cursor-pointer hover:bg-gray-50 transition-colors"
                      style={{ width: columns.find(col => col.dataIndex === header.column.id)?.width }}
                    >
                        <div className="flex items-center space-x-1">
                          <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                          <span className="text-gray-400">
                            {{
                              asc: ' ↑',
                              desc: ' ↓',
                            }[header.column.getIsSorted() as string] ?? null}
                          </span>
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-gray-100">
              {table.getPaginationRowModel().rows.map((row, rowIndex): JSX.Element => {
                // Use the id property if it exists in the data, otherwise use row.id
                const rowId = ('id' in row.original) ? (row.original as { id: string }).id : row.id;
                return (
                  <tr
                    key={`row_${rowId}`}
                    onClick={() => handleRowClick(row)}
                    className={`
                    ${rowIndex % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                    hover:bg-blue-50 transition-colors cursor-pointer
                  `}
                  >
                    {row.getVisibleCells().map((cell, cellIndex): JSX.Element => {
                      const columnId = cell.column.columnDef.id || cell.column.id;
                      const cellValue = cell.getValue();
                      
                      // For columns with custom renders, use the raw value; for others, convert to string
                      const columnDef = columns.find(col => {
                        const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
                        return colId === columnId;
                      });
                      
                      // Extract the display text that would actually be shown to the user
                      const cellContent = getDisplayText(columnDef, cellValue, row.original);
                      
                      const cellId = `${id}-cell-${rowId}-${columnId}`;
                      
                      return (
                        <ReflectedTableCell
                          key={`cell_${rowId}_${columnId}_${cellIndex}`}
                          id={cellId}
                          content={cellContent}
                          className="px-6 py-3 text-[14px] leading-relaxed text-[rgb(var(--color-text-700))] max-w-0 align-top"
                          style={{ width: columns.find(col => col.dataIndex === cell.column.id)?.width }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </ReflectedTableCell>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pagination && data.length > 0 && (
          <div className="px-6 py-4 border-t border-gray-100 bg-white">
            <div className="flex items-center justify-between">
              <button
                onClick={handlePreviousPage}
                disabled={!table.getCanPreviousPage()}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>
              <span className="text-sm text-[rgb(var(--color-text-700))]">
                Page {pageIndex + 1} of{' '}
                {totalPages} ({total} total records)
              </span>
              <button
                onClick={handleNextPage}
                disabled={!table.getCanNextPage()}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        )}
    </div>
  );
};
