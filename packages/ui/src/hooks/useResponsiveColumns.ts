'use client';

import { useEffect, useMemo, useState } from 'react';

export interface ColumnConfig {
  id: string;
  label: string;
  minWidth?: number;
  priority?: number;
  hidden?: boolean;
}

export function useResponsiveColumns(
  columns: ColumnConfig[],
  containerRef: React.RefObject<HTMLElement>,
  minColumnWidth = 200
) {
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(columns.map((c) => c.id));

  const sortedColumns = useMemo(() => {
    const copy = [...columns];
    copy.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    return copy;
  }, [columns]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const resizeObserver = new ResizeObserver(() => {
      const width = el.clientWidth;
      const maxColumns = Math.max(1, Math.floor(width / minColumnWidth));
      const visible = sortedColumns.filter((c) => !c.hidden).slice(0, maxColumns).map((c) => c.id);
      setVisibleColumnIds(visible);
    });

    resizeObserver.observe(el);
    return () => resizeObserver.disconnect();
  }, [containerRef, sortedColumns, minColumnWidth]);

  return { visibleColumnIds };
}

