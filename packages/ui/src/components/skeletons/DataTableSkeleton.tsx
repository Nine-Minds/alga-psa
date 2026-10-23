'use client';

import React from 'react';
import { Skeleton } from '../Skeleton';

interface DataTableSkeletonProps {
  /** Stable id, so a screen keeps its automation id while the rows load. */
  id?: string;
  /** Accessible name announced while the rows load. */
  label: string;
  /** One width class per column, shaping the placeholder like the table it stands in for. */
  columnWidths: string[];
  rows?: number;
}

/** Pulse placeholder wearing the DataTable's card chrome, so the page does not jump when rows land. */
export default function DataTableSkeleton({ id, label, columnWidths, rows = 5 }: DataTableSkeletonProps) {
  return (
    <div
      id={id}
      role="status"
      aria-label={label}
      className="overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] card-elevated"
    >
      <div className="flex items-center gap-4 border-b border-[rgb(var(--color-border-200)/0.7)] bg-[rgb(var(--color-table-row-alt))] px-4 py-2.5">
        {columnWidths.map((width, column) => (
          <Skeleton key={`head-${column}`} className={`h-3 ${width}`} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, row) => (
        <div
          key={`row-${row}`}
          className="flex items-center gap-4 border-b border-[rgb(var(--color-border-100))] px-4 py-3.5 last:border-b-0"
        >
          {columnWidths.map((width, column) => (
            <Skeleton key={`cell-${column}`} className={`h-4 ${width}`} />
          ))}
        </div>
      ))}
    </div>
  );
}
