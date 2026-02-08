import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  SortingState,
  PaginationState,
} from '@tanstack/react-table';
import { Text } from './Text';
import { CustomSelect } from './CustomSelect';
import { Alert } from './Alert';

export type Column<Row> = {
  key: keyof Row & string;
  header: string;
  width?: number | string;
  render?: (row: Row) => React.ReactNode;
  sortable?: boolean;
  /** Column priority for responsive hiding. Lower = higher priority (shown first). Default: 10 */
  priority?: number;
  /** If true, this column is never hidden regardless of available space */
  alwaysShow?: boolean;
};

export type DataTableProps<Row extends Record<string, any>> = {
  columns: Column<Row>[];
  data: Row[];
  initialSortKey?: keyof Row & string;
  /** Initial sort direction. Defaults to 'asc' */
  initialSortDir?: 'asc' | 'desc';
  /** Enable pagination. Default page sizes: [10, 25, 50, 100] */
  paginate?: boolean;
  /** Default page size. Defaults to 10 */
  defaultPageSize?: number;
  /** Custom page size options */
  pageSizeOptions?: number[];
  /** Callback when row is clicked */
  onRowClick?: (row: Row) => void;
  /** Enable responsive column hiding based on container width. Defaults to false */
  responsiveColumns?: boolean;
  /** Minimum column width in pixels for responsive calculations. Defaults to 120 */
  minColumnWidth?: number;
  /** Callback when visible columns change */
  onVisibleColumnsChange?: (visibleKeys: string[]) => void;
};

// Chevron icons
const ChevronLeft = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);

const ChevronRight = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export function DataTable<Row extends Record<string, any>>({
  columns,
  data,
  initialSortKey,
  initialSortDir = 'asc',
  paginate = false,
  defaultPageSize = 10,
  pageSizeOptions = [10, 25, 50, 100],
  onRowClick,
  responsiveColumns = false,
  minColumnWidth = 120,
  onVisibleColumnsChange,
}: DataTableProps<Row>) {
  // Responsive column hiding
  const containerRef = useRef<HTMLDivElement>(null);
  const [visibleColumnKeys, setVisibleColumnKeys] = useState<Set<string>>(
    new Set(columns.map(c => c.key))
  );

  // Calculate which columns should be visible based on container width
  useEffect(() => {
    if (!responsiveColumns) {
      // When not responsive, show all columns
      setVisibleColumnKeys(new Set(columns.map(c => c.key)));
      return;
    }

    const updateVisibleColumns = () => {
      const container = containerRef.current;
      if (!container) return;

      const containerWidth = container.clientWidth;
      if (containerWidth === 0) {
        // Before measurement, show all columns
        setVisibleColumnKeys(new Set(columns.map(c => c.key)));
        return;
      }

      // Sort columns by priority (lower = higher priority)
      // Actions column (last column with render) gets highest priority
      const lastColumn = columns[columns.length - 1];
      const isActionsColumn = lastColumn &&
        (lastColumn.header === 'Actions' || lastColumn.header === 'Action') &&
        lastColumn.render !== undefined;

      const sortedColumns = [...columns].sort((a, b) => {
        // Always-show columns come first
        if (a.alwaysShow && !b.alwaysShow) return -1;
        if (!a.alwaysShow && b.alwaysShow) return 1;

        // Actions column (if it's the last column) gets priority
        if (isActionsColumn) {
          if (a === lastColumn) return -1;
          if (b === lastColumn) return 1;
        }

        // Then sort by priority (lower = higher priority)
        const aPriority = a.priority ?? 10;
        const bPriority = b.priority ?? 10;
        return aPriority - bPriority;
      });

      // Calculate how many columns we can fit
      const maxColumns = Math.max(1, Math.floor(containerWidth / minColumnWidth));

      // Build visible set: always-show columns first, then by priority
      const visible = new Set<string>();
      let usedWidth = 0;

      // First pass: add alwaysShow columns
      for (const col of sortedColumns) {
        if (col.alwaysShow) {
          visible.add(col.key);
          usedWidth += minColumnWidth;
        }
      }

      // Second pass: add remaining columns by priority until we hit the limit
      for (const col of sortedColumns) {
        if (col.alwaysShow) continue;
        if (visible.size >= maxColumns) break;
        if (usedWidth + minColumnWidth <= containerWidth) {
          visible.add(col.key);
          usedWidth += minColumnWidth;
        }
      }

      setVisibleColumnKeys(visible);
    };

    // Initial measurement
    updateVisibleColumns();

    // Set up ResizeObserver for container width changes
    const container = containerRef.current;
    if (container && typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        updateVisibleColumns();
      });
      resizeObserver.observe(container);

      // Also listen to window resize as fallback
      window.addEventListener('resize', updateVisibleColumns);

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', updateVisibleColumns);
      };
    } else {
      // Fallback: just use window resize
      window.addEventListener('resize', updateVisibleColumns);
      return () => {
        window.removeEventListener('resize', updateVisibleColumns);
      };
    }
  }, [columns, responsiveColumns, minColumnWidth]);

  // Notify parent when visible columns change
  useEffect(() => {
    if (onVisibleColumnsChange) {
      onVisibleColumnsChange(Array.from(visibleColumnKeys));
    }
  }, [visibleColumnKeys, onVisibleColumnsChange]);

  // Filter columns based on visibility
  const visibleColumns = useMemo(() => {
    if (!responsiveColumns) return columns;
    return columns.filter(c => visibleColumnKeys.has(c.key));
  }, [columns, visibleColumnKeys, responsiveColumns]);

  const hiddenColumnCount = columns.length - visibleColumns.length;

  // --- tanstack/react-table setup ---

  // Sorting state: convert our props to tanstack SortingState
  const [sorting, setSorting] = useState<SortingState>(
    initialSortKey ? [{ id: initialSortKey, desc: initialSortDir === 'desc' }] : []
  );

  // Pagination state
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  // Reset page to 0 when data changes or page size changes
  useEffect(() => {
    setPagination(prev => ({ ...prev, pageIndex: 0 }));
  }, [data.length, pagination.pageSize]);

  // Convert Column<Row>[] to tanstack ColumnDef<Row>[]
  const tableColumns = useMemo(
    () =>
      visibleColumns.map(
        (col): ColumnDef<Row, unknown> => ({
          id: col.key,
          accessorKey: col.key,
          header: col.header,
          cell: (info) =>
            col.render
              ? col.render(info.row.original)
              : String(info.getValue() ?? ''),
          size: typeof col.width === 'number' ? col.width : undefined,
          enableSorting: col.sortable !== false,
        })
      ),
    [visibleColumns]
  );

  // Table instance
  const table = useReactTable({
    data,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(paginate ? { getPaginationRowModel: getPaginationRowModel() } : {}),
    state: {
      sorting,
      ...(paginate ? { pagination } : {}),
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
  });

  // Derive rows: when paginating use getRowModel() which returns paginated+sorted rows,
  // otherwise also getRowModel() which returns sorted rows.
  const rows = table.getRowModel().rows;
  const totalRows = paginate ? table.getFilteredRowModel().rows.length : data.length;

  // Pagination helpers
  const totalPages = paginate ? table.getPageCount() : 1;
  const currentPage = pagination.pageIndex + 1; // 1-indexed for display
  const pageSize = pagination.pageSize;

  const setCurrentPage = useCallback((pageOrFn: number | ((prev: number) => number)) => {
    setPagination(prev => {
      const newPage = typeof pageOrFn === 'function'
        ? pageOrFn(prev.pageIndex + 1)
        : pageOrFn;
      return { ...prev, pageIndex: newPage - 1 };
    });
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPagination({ pageIndex: 0, pageSize: size });
  }, []);

  // Generate page buttons with ellipsis
  const renderPageButtons = () => {
    const buttons: React.ReactNode[] = [];
    const maxVisiblePages = 5;
    const sidePages = Math.floor(maxVisiblePages / 2);

    let startPage = Math.max(1, currentPage - sidePages);
    let endPage = Math.min(totalPages, currentPage + sidePages);

    if (currentPage <= sidePages) {
      endPage = Math.min(totalPages, maxVisiblePages);
    } else if (currentPage >= totalPages - sidePages) {
      startPage = Math.max(1, totalPages - maxVisiblePages + 1);
    }

    // First page and ellipsis
    if (startPage > 1) {
      buttons.push(
        <button
          key={1}
          onClick={() => setCurrentPage(1)}
          style={pageButtonStyle}
        >
          1
        </button>
      );
      if (startPage > 2) {
        buttons.push(<span key="ellipsis-start" style={ellipsisStyle}>...</span>);
      }
    }

    // Range of pages
    for (let i = startPage; i <= endPage; i++) {
      buttons.push(
        <button
          key={i}
          onClick={() => setCurrentPage(i)}
          style={currentPage === i ? activePageButtonStyle : pageButtonStyle}
        >
          {i}
        </button>
      );
    }

    // Last page and ellipsis
    if (endPage < totalPages) {
      if (endPage < totalPages - 1) {
        buttons.push(<span key="ellipsis-end" style={ellipsisStyle}>...</span>);
      }
      buttons.push(
        <button
          key={totalPages}
          onClick={() => setCurrentPage(totalPages)}
          style={pageButtonStyle}
        >
          {totalPages}
        </button>
      );
    }

    return buttons;
  };

  // Calculate item range
  const firstItem = totalRows === 0 ? 0 : pagination.pageIndex * pageSize + 1;
  const lastItem = Math.min((pagination.pageIndex + 1) * pageSize, totalRows);

  // --- Styles ---
  const containerStyle: React.CSSProperties = {
    overflow: 'hidden',
    backgroundColor: 'var(--alga-bg, #fff)',
    borderRadius: 'var(--alga-radius, 8px)',
    border: '1px solid var(--alga-border, #e5e7eb)',
  };

  const tableStyle: React.CSSProperties = {
    width: '100%',
    borderCollapse: 'collapse',
  };

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '12px 24px',
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--alga-muted-fg, #6b7280)',
    letterSpacing: '0.05em',
    backgroundColor: 'var(--alga-bg, #fff)',
    borderBottom: '1px solid var(--alga-border, #e5e7eb)',
  };

  const tdStyle: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: '14px',
    color: 'var(--alga-fg, #374151)',
    borderBottom: '1px solid var(--alga-border-light, #f3f4f6)',
  };

  const paginationStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '12px 24px',
    gap: '24px',
    borderTop: '1px solid var(--alga-border-light, #f3f4f6)',
    backgroundColor: 'var(--alga-bg, #fff)',
  };

  const pageButtonStyle: React.CSSProperties = {
    padding: '4px 8px',
    border: '1px solid var(--alga-border, #e5e7eb)',
    borderRadius: 'var(--alga-radius, 6px)',
    backgroundColor: 'var(--alga-bg, #fff)',
    color: 'var(--alga-muted-fg, #6b7280)',
    fontSize: '14px',
    fontWeight: 500,
    cursor: 'pointer',
    minWidth: '32px',
  };

  const activePageButtonStyle: React.CSSProperties = {
    ...pageButtonStyle,
    borderColor: 'var(--alga-primary, #8a4dea)',
    color: 'var(--alga-primary, #8a4dea)',
    backgroundColor: 'var(--alga-primary-50, #f0e6fd)',
  };

  const navButtonStyle: React.CSSProperties = {
    padding: '4px 6px',
    border: '1px solid var(--alga-border, #e5e7eb)',
    borderRadius: 'var(--alga-radius, 6px)',
    backgroundColor: 'var(--alga-bg, #fff)',
    color: 'var(--alga-fg, #374151)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };

  const disabledNavButtonStyle: React.CSSProperties = {
    ...navButtonStyle,
    opacity: 0.5,
    cursor: 'not-allowed',
  };

  const ellipsisStyle: React.CSSProperties = {
    padding: '4px 8px',
    border: '1px solid var(--alga-border, #e5e7eb)',
    borderRadius: 'var(--alga-radius, 6px)',
    backgroundColor: 'var(--alga-bg, #fff)',
    color: 'var(--alga-muted-fg, #6b7280)',
    fontSize: '14px',
  };

  return (
    <div ref={containerRef} style={containerStyle}>
      {hiddenColumnCount > 0 && (
        <Alert tone="info" style={{ borderRadius: 0, borderLeft: 'none', borderRight: 'none', borderTop: 'none' }}>
          <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px', flexShrink: 0 }}>
              <path d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            {hiddenColumnCount} column{hiddenColumnCount > 1 ? 's' : ''} hidden due to limited space. Resize to see more.
          </div>
        </Alert>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map(header => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();

                  return (
                    <th
                      key={header.id}
                      style={thStyle}
                    >
                      <button
                        onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: canSort ? 'pointer' : 'default',
                          padding: 0,
                          fontWeight: 500,
                          fontSize: 'inherit',
                          textTransform: 'inherit',
                          letterSpacing: 'inherit',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                        }}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {sortDir && (
                          <span style={{ color: 'var(--alga-muted-fg)' }}>
                            {sortDir === 'asc' ? '\u2191' : '\u2193'}
                          </span>
                        )}
                      </button>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={row.id}
                onClick={() => onRowClick?.(row.original)}
                style={{
                  backgroundColor: i % 2 === 0 ? 'var(--alga-muted, #f9fafb)' : 'var(--alga-bg, #fff)',
                  cursor: onRowClick ? 'pointer' : 'default',
                  transition: 'background-color 0.15s',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--alga-primary-50, #eff6ff)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = i % 2 === 0 ? 'var(--alga-muted, #f9fafb)' : 'var(--alga-bg, #fff)';
                }}
              >
                {row.getVisibleCells().map(cell => {
                  return (
                    <td
                      key={cell.id}
                      style={tdStyle}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} style={{ ...tdStyle, textAlign: 'center', color: 'var(--alga-muted-fg)' }}>
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginate && (totalPages > 1 || totalRows > 0) && (
        <div style={paginationStyle}>
          <Text tone="muted" style={{ fontSize: '14px' }}>
            {totalRows === 0 ? '0 items' : `${firstItem}\u2013${lastItem} of ${totalRows} items`}
          </Text>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <button
                style={currentPage === 1 ? disabledNavButtonStyle : navButtonStyle}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
              >
                <ChevronLeft />
              </button>
              {renderPageButtons()}
              <button
                style={currentPage === totalPages ? disabledNavButtonStyle : navButtonStyle}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
              >
                <ChevronRight />
              </button>
            </div>
          )}

          <CustomSelect
            options={pageSizeOptions.map(n => ({ value: String(n), label: `${n} per page` }))}
            value={String(pageSize)}
            onValueChange={(value) => setPageSize(Number(value))}
            style={{ width: 'auto', minWidth: '120px' }}
          />
        </div>
      )}
    </div>
  );
}
