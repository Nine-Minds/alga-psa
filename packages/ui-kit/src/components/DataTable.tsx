import React, { useMemo, useState } from 'react';
import { Text } from './Text';
import { CustomSelect } from './CustomSelect';

export type Column<Row> = {
  key: keyof Row & string;
  header: string;
  width?: number | string;
  render?: (row: Row) => React.ReactNode;
  sortable?: boolean;
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
};

type SortState<Row> = { key: keyof Row & string; dir: 'asc' | 'desc' } | null;

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
}: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState<Row>>(initialSortKey ? { key: initialSortKey, dir: initialSortDir } : null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);

  const sorted = useMemo(() => {
    if (!sort) return data;
    const col = columns.find(c => c.key === sort.key);
    if (!col) return data;
    const copy = [...data];
    copy.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return sort.dir === 'asc' ? -1 : 1;
      if (bv == null) return sort.dir === 'asc' ? 1 : -1;
      if (typeof av === 'number' && typeof bv === 'number') return sort.dir === 'asc' ? av - bv : bv - av;
      return sort.dir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [data, sort, columns]);

  // Pagination logic
  const totalPages = paginate ? Math.ceil(sorted.length / pageSize) : 1;
  const paginatedData = useMemo(() => {
    if (!paginate) return sorted;
    const start = (currentPage - 1) * pageSize;
    return sorted.slice(start, start + pageSize);
  }, [sorted, paginate, currentPage, pageSize]);

  // Reset to page 1 when data changes or page size changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [data.length, pageSize]);

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
  const firstItem = sorted.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const lastItem = Math.min(currentPage * pageSize, sorted.length);

  // Styles
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
    textTransform: 'uppercase',
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
    <div style={containerStyle}>
      <div style={{ overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              {columns.map(c => (
                <th key={c.key} style={{ ...thStyle, width: c.width }}>
                  <button
                    onClick={() => c.sortable !== false && setSort(s => (!s || s.key !== c.key) ? { key: c.key, dir: 'asc' } : { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' })}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'inherit',
                      cursor: c.sortable === false ? 'default' : 'pointer',
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
                    {c.header}
                    {sort?.key === c.key && (
                      <span style={{ color: 'var(--alga-muted-fg)' }}>
                        {sort.dir === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paginatedData.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
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
                {columns.map(c => (
                  <td key={c.key} style={{ ...tdStyle, width: c.width }}>
                    {c.render ? c.render(row) : String(row[c.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {paginatedData.length === 0 && (
              <tr>
                <td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: 'var(--alga-muted-fg)' }}>
                  No results
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paginate && (totalPages > 1 || sorted.length > 0) && (
        <div style={paginationStyle}>
          <Text tone="muted" style={{ fontSize: '14px' }}>
            {sorted.length === 0 ? '0 items' : `${firstItem}–${lastItem} of ${sorted.length} items`}
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
