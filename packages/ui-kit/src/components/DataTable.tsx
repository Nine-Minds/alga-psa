import React, { useMemo, useState } from 'react';
import { Text } from './Text';

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
};

type SortState<Row> = { key: keyof Row & string; dir: 'asc' | 'desc' } | null;

export function DataTable<Row extends Record<string, any>>({ columns, data, initialSortKey }: DataTableProps<Row>) {
  const [sort, setSort] = useState<SortState<Row>>(initialSortKey ? { key: initialSortKey, dir: 'asc' } : null);

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

  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '8px 12px',
    fontSize: 12,
    color: 'var(--alga-muted-fg)',
    borderBottom: '1px solid var(--alga-border)'
  };
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 14,
    color: 'var(--alga-fg)',
    borderBottom: '1px solid var(--alga-border)'
  };
  const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'separate', borderSpacing: 0 };

  return (
    <div style={{ overflow: 'auto', border: '1px solid var(--alga-border)', borderRadius: 'var(--alga-radius)' }}>
      <table style={tableStyle}>
        <thead style={{ background: 'var(--alga-muted)' }}>
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
                    fontWeight: 600
                  }}
                >
                  {c.header}
                  {sort?.key === c.key ? <Text tone="muted" style={{ marginLeft: 6 }}>{sort.dir === 'asc' ? '▲' : '▼'}</Text> : null}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={i}>
              {columns.map(c => (
                <td key={c.key} style={{ ...tdStyle, width: c.width }}>
                  {c.render ? c.render(row) : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={columns.length} style={{ ...tdStyle, textAlign: 'center', color: 'var(--alga-muted-fg)' }}>
                No results
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
