'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface ColumnConfig {
  /** Column identifier - use either 'id' or 'key' */
  id?: string;
  /** Column identifier - alias for 'id' */
  key?: string;
  /** Column label for display */
  label?: string;
  minWidth?: number;
  priority?: number;
  hidden?: boolean;
  /** Whether this column should always be shown regardless of width */
  alwaysShow?: boolean;
}

export interface UseResponsiveColumnsOptions {
  columns: ColumnConfig[];
  /** Padding to account for scrollbars, cell padding, borders, etc. */
  containerPadding?: number;
  /** Minimum width per column before hiding */
  minColumnWidth?: number;
}

/** Helper to get column identifier (supports both 'id' and 'key') */
const getColumnId = (col: ColumnConfig): string => col.id ?? col.key ?? '';

export function useResponsiveColumns(options: UseResponsiveColumnsOptions) {
  const { columns, containerPadding = 0, minColumnWidth = 200 } = options;
  const containerRef = useRef<HTMLDivElement>(null);

  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    columns.map((c) => getColumnId(c))
  );

  const sortedColumns = useMemo(() => {
    const copy = [...columns];
    copy.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return copy;
  }, [columns]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(() => {
      const width = el.clientWidth - containerPadding;
      const maxColumns = Math.max(1, Math.floor(width / minColumnWidth));
      const visible = sortedColumns
        .filter((c) => !c.hidden && (c.alwaysShow || true))
        .slice(0, maxColumns)
        .map((c) => getColumnId(c));
      setVisibleColumnIds(visible);
    });

    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [containerRef, sortedColumns, minColumnWidth, containerPadding]);

  const isColumnVisible = (columnId: string): boolean => visibleColumnIds.includes(columnId);
  const hiddenColumnCount = columns.length - visibleColumnIds.length;

  return { visibleColumnIds, isColumnVisible, hiddenColumnCount, containerRef };
}

