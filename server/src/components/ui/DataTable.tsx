import React, { useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  ColumnDef,
  Row,
} from '@tanstack/react-table';
import { ColumnDefinition, DataTableProps } from '@/interfaces/dataTable.interfaces';

// Helper function to get nested property value
const getNestedValue = (obj: unknown, path: string | string[]): unknown => {
  if (typeof obj !== 'object' || obj === null) {
    return undefined;
  }
  
  const keys = Array.isArray(path) ? path : path.split('.');
  return keys.reduce((acc: unknown, key: string) => {
    if (acc && typeof acc === 'object' && key in acc) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
};

export const DataTable = <T extends object>({
  data,
  columns,
  pagination = true,
  onRowClick,
  currentPage = 1,
  onPageChange,
  pageSize = 10,
  totalItems,
}: DataTableProps<T>): React.ReactElement => {
  // Create stable column definitions
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((col): ColumnDef<T> => ({
        id: Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : col.dataIndex,
        accessorFn: (row) => getNestedValue(row, col.dataIndex),
        header: () => col.title,
        cell: (info) => col.render ? col.render(info.getValue(), info.row.original, info.row.index) : info.getValue(),
      })),
    [columns.map((col):unknown => ({ 
      id: Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : col.dataIndex,
      title: col.title,
      hasRender: !!col.render 
    }))]
  );

  // Calculate pagination values using totalItems if provided, otherwise use data.length
  const total = totalItems ?? data.length;
  const totalPages = Math.ceil(total / pageSize);

  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const handleRowClick = (row: Row<T>) => {
    if (onRowClick) {
      onRowClick(row.original);
    }
  };

  const handlePreviousPage = () => {
    if (onPageChange && currentPage > 1) {
      onPageChange(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (onPageChange && currentPage < totalPages) {
      onPageChange(currentPage + 1);
    }
  };

  return (
    <div className="datatable-container overflow-hidden bg-white rounded-lg border border-gray-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-white">
            {table.getHeaderGroups().map((headerGroup):JSX.Element => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header):JSX.Element => (
                  <th 
                    key={`${headerGroup.id}_${header.id}`}
                    onClick={header.column.getToggleSortingHandler()}
                    className="px-6 py-3 text-left text-xs font-medium text-[rgb(var(--color-text-700))] tracking-wider cursor-pointer hover:bg-gray-50 transition-colors"
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
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="divide-y divide-gray-100">
            {table.getRowModel().rows.map((row, index):JSX.Element => (
              <tr
                key={row.id}
                onClick={() => handleRowClick(row)}
                className={`
                  ${index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}
                  hover:bg-blue-50 transition-colors cursor-pointer
                `}
              >
                {row.getVisibleCells().map((cell, cellIndex):JSX.Element => (
                  <td 
                    key={`${row.index}-${cellIndex}`}
                    className="px-6 py-4 whitespace-nowrap text-[14px] text-[rgb(var(--color-text-700))]"
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && data.length > 0 && (
        <div className="px-6 py-4 border-t border-gray-100 bg-white">
          <div className="flex items-center justify-between">
            <button
              onClick={handlePreviousPage}
              disabled={currentPage <= 1}
              className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-[rgb(var(--color-text-700))] bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>
            <span className="text-sm text-[rgb(var(--color-text-700))]">
              Page {currentPage} of {totalPages} ({total} total records)
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= totalPages}
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
