'use client';

import * as React from 'react';
import { cn } from '../lib/utils';

export interface PrintableTableColumn<T> {
  key: string;
  header: React.ReactNode;
  render: (row: T) => React.ReactNode;
  className?: string;
}

export interface PrintableTableProps<T> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  rows: T[];
  columns: PrintableTableColumn<T>[];
  getRowKey: (row: T) => string;
  emptyMessage?: React.ReactNode;
  className?: string;
}

export function PrintableTable<T>({
  title,
  subtitle,
  rows,
  columns,
  getRowKey,
  emptyMessage,
  className,
}: PrintableTableProps<T>): React.ReactElement {
  return (
    <section className={cn('app-print-table-section', className)}>
      {(title || subtitle) && (
        <header className="app-print-table-header">
          {title && <h2>{title}</h2>}
          {subtitle && <p>{subtitle}</p>}
        </header>
      )}
      <table className="app-print-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.className}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="app-print-table-empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
