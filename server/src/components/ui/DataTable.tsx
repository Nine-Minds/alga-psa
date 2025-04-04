import React, { useMemo } from 'react';
import { useRegisterUIComponent } from 'server/src/types/ui-reflection/useRegisterUIComponent';
import { DataTableComponent, AutomationProps } from 'server/src/types/ui-reflection/types';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  Row,
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

export interface ExtendedDataTableProps<T extends object> extends DataTableProps<T>, AutomationProps {
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
    editableConfig
  } = props;

  // Register with UI reflection system if id is provided
  const updateMetadata = id ? useRegisterUIComponent<DataTableComponent>({
    id: `${id}-table`,
    type: 'dataTable',
    columns: columns.map((col): { id: string; title: string; dataIndex: string | string[]; hasCustomRender: boolean } => ({
      id: Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex,
      title: String(col.title), // Convert ReactNode to string
      dataIndex: col.dataIndex,
      hasCustomRender: !!col.render
    })),
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

  // Create stable column definitions
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((col): ColumnDef<T> => ({
        id: Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex,
        accessorFn: (row) => getNestedValue(row, col.dataIndex),
        header: () => col.title,
        cell: (info) => col.render ? col.render(info.getValue(), info.row.original, info.row.index) : info.getValue(),
      })),
    [columns]
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

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    pageCount: totalPages,
    state: {
      pagination: {
        pageIndex,
        pageSize: currentPageSize,
      },
    },
    onPaginationChange: setPagination,
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

  // Notify parent component of page changes and update reflection metadata
  React.useEffect(() => {
    if (onPageChange) {
      onPageChange(pageIndex + 1);
    }

    // Update reflection metadata when pagination or sorting changes
    if (updateMetadata) {
      updateMetadata({
        pagination: {
          enabled: pagination,
          currentPage: pageIndex + 1,
          pageSize: currentPageSize,
          totalItems: totalItems ?? data.length,
          totalPages: Math.ceil((totalItems ?? data.length) / currentPageSize)
        },
        rowCount: data.length,
        visibleRows: table.getPaginationRowModel().rows.map((row): { id: string; values: Record<string, unknown> } => ({
          id: ('id' in row.original) ? (row.original as { id: string }).id : '',
          values: row.original as Record<string, unknown>
        })),
        sortedBy: table.getState().sorting[0] ? {
          column: table.getState().sorting[0].id,
          direction: table.getState().sorting[0].desc ? 'desc' : 'asc'
        } : undefined
      });
    }
  }, [pageIndex, currentPageSize, data.length, totalItems, pagination, onPageChange, updateMetadata, table]);

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
    >
      <ReflectionContainer id={`${id}-table`}>
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
              {table.getPaginationRowModel().rows.map((row): JSX.Element => {
                // Use the id property if it exists in the data, otherwise use row.id
                const rowId = ('id' in row.original) ? (row.original as { id: string }).id : row.id;
                return (
                  <tr
                    key={`row_${rowId}`}
                    onClick={() => handleRowClick(row)}
                    className={`
                    ${row.index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                    hover:bg-blue-50 transition-colors cursor-pointer
                  `}
                  >
                    {row.getVisibleCells().map((cell, cellIndex): JSX.Element => {
                      const columnId = cell.column.columnDef.id || cell.column.id;
                      return (
                        <td
                          key={`cell_${rowId}_${columnId}_${cellIndex}`}
                          className="px-6 py-4 text-[14px] text-[rgb(var(--color-text-700))] max-w-0"
                          style={{ width: columns.find(col => col.dataIndex === cell.column.id)?.width }}
                        >
                        <div className="truncate w-full">
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </div>
                        </td>
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
      </ReflectionContainer>
    </div>
  );
};
