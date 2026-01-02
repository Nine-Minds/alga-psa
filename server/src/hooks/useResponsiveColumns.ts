import { useState, useEffect, useRef, useMemo } from 'react';

export interface ColumnConfig {
  key: string;
  minWidth: number;      // Minimum width in pixels for this column
  priority: number;      // Lower number = higher priority (always show first)
  alwaysShow?: boolean;  // If true, this column is never hidden
}

interface UseResponsiveColumnsOptions {
  columns: ColumnConfig[];
  minColumnWidth?: number;  // Default minimum width for columns without explicit minWidth
  containerPadding?: number; // Padding to account for in calculations
}

interface UseResponsiveColumnsResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  visibleColumns: Set<string>;
  isColumnVisible: (key: string) => boolean;
  hiddenColumnCount: number;
}

/**
 * Hook to manage responsive column visibility based on container width.
 * Columns are hidden based on priority when container width is insufficient.
 *
 * @param options Configuration options for responsive columns
 * @returns Object containing containerRef, visibleColumns set, and isColumnVisible helper
 */
export function useResponsiveColumns(options: UseResponsiveColumnsOptions): UseResponsiveColumnsResult {
  const { columns, minColumnWidth = 100, containerPadding = 0 } = options;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);

  // Sort columns by priority (lower number = higher priority)
  const sortedColumns = useMemo(() => {
    return [...columns].sort((a, b) => {
      // Always-show columns come first
      if (a.alwaysShow && !b.alwaysShow) return -1;
      if (!a.alwaysShow && b.alwaysShow) return 1;
      // Then sort by priority
      return a.priority - b.priority;
    });
  }, [columns]);

  // Calculate which columns should be visible
  const visibleColumns = useMemo(() => {
    if (containerWidth === 0) {
      // Before measurement, show all columns
      return new Set(columns.map(c => c.key));
    }

    const availableWidth = containerWidth - containerPadding;
    const visible = new Set<string>();
    let usedWidth = 0;

    // Always add alwaysShow columns first
    for (const col of sortedColumns) {
      if (col.alwaysShow) {
        visible.add(col.key);
        usedWidth += col.minWidth || minColumnWidth;
      }
    }

    // Then add remaining columns by priority until we run out of space
    for (const col of sortedColumns) {
      if (col.alwaysShow) continue; // Already added

      const colWidth = col.minWidth || minColumnWidth;
      if (usedWidth + colWidth <= availableWidth) {
        visible.add(col.key);
        usedWidth += colWidth;
      }
    }

    return visible;
  }, [containerWidth, sortedColumns, minColumnWidth, containerPadding, columns]);

  // Set up ResizeObserver to track container width changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateWidth = () => {
      setContainerWidth(container.clientWidth);
    };

    // Initial measurement
    updateWidth();

    // Set up ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });

    resizeObserver.observe(container);

    // Also listen to window resize as fallback
    window.addEventListener('resize', updateWidth);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateWidth);
    };
  }, []);

  const isColumnVisible = (key: string): boolean => {
    return visibleColumns.has(key);
  };

  // Calculate hidden column count
  const hiddenColumnCount = columns.length - visibleColumns.size;

  return {
    containerRef,
    visibleColumns,
    isColumnVisible,
    hiddenColumnCount,
  };
}
