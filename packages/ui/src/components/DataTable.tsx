'use client'; // Added directive

import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useRegisterUIComponent } from '../ui-reflection/useRegisterUIComponent';
import { DataTableComponent, AutomationProps, TextComponent } from '../ui-reflection/types';
import { useRegisterChild } from '../ui-reflection/useRegisterChild';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  flexRender,
  ColumnDef,
  ColumnSizingState,
  Row,
  SortingFn,
  SortingState,
} from '@tanstack/react-table';
import { ColumnDefinition, DataTableProps } from '@alga-psa/types';
import { ReflectionContainer } from '../ui-reflection/ReflectionContainer';
import { cn } from '../lib/utils';
import Pagination from './Pagination';
import { Alert, AlertDescription } from './Alert';
import { Tooltip } from './Tooltip';
import { useTranslation } from '../lib/i18n/client';

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

const extractTextFromReactNode = (node: React.ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') {
    return '';
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(extractTextFromReactNode).filter(Boolean).join(' ');
  }

  if (React.isValidElement(node)) {
    const resultProps = node.props as { children?: React.ReactNode };
    return extractTextFromReactNode(resultProps.children);
  }

  return '';
};

// Helper function to extract display text from column render function
const getDisplayText = (columnDef: ColumnDefinition<any> | undefined, cellValue: unknown, rowData: any): string => {
  if (!columnDef || !columnDef.render) {
    // No custom render, use the raw value
    return typeof cellValue === 'string' ? cellValue : String(cellValue || '');
  }

  // For columns with render functions, simulate what the render would show
  const renderResult = columnDef.render(cellValue, rowData, 0);
  
  // If render returns a string, use it directly
  if (typeof renderResult === 'string') {
    return renderResult;
  }
  
  const renderedText = extractTextFromReactNode(renderResult);
  if (renderedText) {
    return renderedText;
  }
  
  // Fallback: use the original value with N/A handling
  if (cellValue === null || cellValue === undefined || cellValue === '') {
    return 'N/A';
  }
  
  return String(cellValue);
};

const COLUMN_SIZE_BASE_WIDTH = 1800;
const DEFAULT_COLUMN_SIZE = 160;
const COMPACT_COLUMN_IDS = new Set(['selection', 'actions', 'tags']);

const getColumnId = (dataIndex: string | string[]): string => (
  Array.isArray(dataIndex) ? dataIndex.join('_') : dataIndex
);

const parseColumnWidth = (width: string | undefined): number | undefined => {
  if (!width) return undefined;

  const trimmed = width.trim();
  if (trimmed.endsWith('px')) {
    const px = Number.parseFloat(trimmed);
    return Number.isFinite(px) ? Math.round(px) : undefined;
  }

  if (trimmed.endsWith('%')) {
    const percent = Number.parseFloat(trimmed);
    return Number.isFinite(percent) ? Math.round((percent / 100) * COLUMN_SIZE_BASE_WIDTH) : undefined;
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
};

const getColumnSizeConfig = (column: ColumnDefinition<any>): { size: number; minSize: number; maxSize: number } => {
  const columnId = getColumnId(column.dataIndex);
  const parsedWidth = parseColumnWidth(column.width);
  const titleLength = typeof column.title === 'string' ? column.title.length : 12;

  if (COMPACT_COLUMN_IDS.has(columnId)) {
    return {
      size: parsedWidth ?? 64,
      minSize: columnId === 'selection' ? 44 : 56,
      maxSize: 180,
    };
  }

  if (columnId === 'title') {
    return {
      size: parsedWidth ?? 320,
      minSize: 180,
      maxSize: 720,
    };
  }

  return {
    size: parsedWidth ?? Math.max(DEFAULT_COLUMN_SIZE, Math.min(280, titleLength * 12 + 72)),
    minSize: 96,
    maxSize: 520,
  };
};

// Custom case-insensitive sorting function for all columns
const caseInsensitiveSort: SortingFn<any> = (rowA, rowB, columnId) => {
  const a = rowA.getValue(columnId);
  const b = rowB.getValue(columnId);

  // Try to parse as dates - if both are valid dates, compare as timestamps
  const parseDate = (val: unknown): Date | null => {
    if (val instanceof Date) return val;
    if (typeof val === 'string' || typeof val === 'number') {
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  };
  const aDate = parseDate(a);
  const bDate = parseDate(b);

  if (aDate && !isNaN(aDate.getTime()) && bDate && !isNaN(bDate.getTime())) {
    return aDate.getTime() - bDate.getTime();
  }

  return String(a ?? '').toLowerCase().localeCompare(String(b ?? '').toLowerCase());
};

interface OverflowTooltipProps {
  text?: string;
  children: React.ReactNode;
  className?: string;
}

const isElementOverflowing = (element: HTMLElement): boolean => (
  element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1
);

const hasOverflow = (element: HTMLElement): boolean => {
  if (isElementOverflowing(element)) {
    return true;
  }

  return Array.from(element.querySelectorAll<HTMLElement>('*')).some(isElementOverflowing);
};

// Shows the custom Tooltip only when the content is actually truncated. The open state is
// controlled and vetoed in onOpenChange so overflow is measured lazily (on hover) — no tooltip
// is shown for content that fits.
const OverflowTooltip = ({ text, children, className }: OverflowTooltipProps) => {
  const contentRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(false);
      return;
    }
    const element = contentRef.current;
    if (text && element && hasOverflow(element)) {
      setOpen(true);
    }
  };

  const content = (
    <div ref={contentRef} className={className}>
      {children}
    </div>
  );

  if (!text) {
    return content;
  }

  return (
    <Tooltip content={text} open={open} onOpenChange={handleOpenChange}>
      {content}
    </Tooltip>
  );
};

const OverflowTooltipSpan = ({ text, children, className }: OverflowTooltipProps) => {
  const contentRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOpen(false);
      return;
    }
    const element = contentRef.current;
    if (text && element && hasOverflow(element)) {
      setOpen(true);
    }
  };

  const content = (
    <span ref={contentRef} className={className}>
      {children}
    </span>
  );

  if (!text) {
    return content;
  }

  return (
    <Tooltip content={text} open={open} onOpenChange={handleOpenChange}>
      {content}
    </Tooltip>
  );
};

// Component to register table cell content with UI reflection system
interface ReflectedTableCellProps {
  id: string;
  content: string;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

const ReflectedTableCell = ({ 
  id, 
  content, 
  children, 
  className, 
  style 
}: ReflectedTableCellProps) => {
  // Register the cell with UI reflection system
  const updateCellMetadata = useRegisterChild<TextComponent>({
    id: id || '__skip_registration_cell',
    type: 'text',
    text: content
  });
  
  // Only update metadata when content changes
  useEffect(() => {
    if (updateCellMetadata && content) {
      updateCellMetadata({ text: content });
    }
  }, [content, updateCellMetadata]);
  
  const tooltipText = content && content !== 'N/A' ? content : undefined;

  return (
    <td
      className={className}
      style={style}
      data-automation-id={id}
    >
      <OverflowTooltip
        text={tooltipText}
        className="min-w-0 overflow-hidden whitespace-nowrap [&_.break-all]:![overflow-wrap:normal] [&_.break-all]:![word-break:normal] [&_.break-words]:![overflow-wrap:normal] [&_.flex-wrap]:!flex-nowrap [&_a]:block [&_a]:max-w-full [&_a]:overflow-hidden [&_a]:text-ellipsis [&_a]:!text-[rgb(var(--color-text-800))] [&_a]:!whitespace-nowrap [&_a]:![overflow-wrap:normal] [&_a]:![word-break:normal] [&_a:hover]:!text-[rgb(var(--color-primary-700))] [&_button]:max-w-full [&_button]:overflow-hidden [&_button]:text-ellipsis [&_button]:!whitespace-nowrap"
      >
        {children}
      </OverflowTooltip>
    </td>
  );
};

export interface ExtendedDataTableProps<T extends object> extends DataTableProps<T> {
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
    editableConfig,
    manualSorting = false,
    sortBy,
    sortDirection,
    onSortChange,
    rowClassName,
    initialSorting,
    onVisibleRowsChange,
    onItemsPerPageChange,
    itemsPerPageOptions,
  } = props;
  const { t } = useTranslation('common');
  const defaultItemsPerPageOptions = useMemo(() => [
    { value: '10', label: t('pagination.itemsPerPageOption', { count: 10, defaultValue: '10 per page' }) },
    { value: '25', label: t('pagination.itemsPerPageOption', { count: 25, defaultValue: '25 per page' }) },
    { value: '50', label: t('pagination.itemsPerPageOption', { count: 50, defaultValue: '50 per page' }) },
    { value: '100', label: t('pagination.itemsPerPageOption', { count: 100, defaultValue: '100 per page' }) },
  ], [t]);
  const safeData = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  // Reference to the table container for measuring available width
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const suppressNextHeaderSortClickRef = useRef(false);
  const suppressHeaderSortClickTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suppressNextHeaderSortClick = () => {
    suppressNextHeaderSortClickRef.current = true;
    if (suppressHeaderSortClickTimeoutRef.current) {
      clearTimeout(suppressHeaderSortClickTimeoutRef.current);
    }
    suppressHeaderSortClickTimeoutRef.current = setTimeout(() => {
      suppressNextHeaderSortClickRef.current = false;
      suppressHeaderSortClickTimeoutRef.current = null;
    }, 500);
  };

  useEffect(() => () => {
    if (suppressHeaderSortClickTimeoutRef.current) {
      clearTimeout(suppressHeaderSortClickTimeoutRef.current);
    }
  }, []);
  
  // State to track which columns should be visible
  const [visibleColumnIds, setVisibleColumnIds] = useState<string[]>(
    columns.map(col => getColumnId(col.dataIndex))
  );
  // When true, every column renders and the table scrolls horizontally; otherwise only the
  // columns that fully fit the container are shown (no horizontal overflow).
  const [showAllColumns, setShowAllColumns] = useState(false);

  const columnIds = useMemo(() => columns.map(col => getColumnId(col.dataIndex)), [columns]);
  const columnSizingStorageKey = id ? `datatable-column-sizing:${id}` : null;
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [hasLoadedColumnSizing, setHasLoadedColumnSizing] = useState(false);

  useEffect(() => {
    if (!columnSizingStorageKey || typeof window === 'undefined') {
      setColumnSizing({});
      setHasLoadedColumnSizing(true);
      return;
    }

    try {
      const stored = window.localStorage.getItem(columnSizingStorageKey);
      const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : {};
      const validColumnIds = new Set(columnIds);
      const nextSizing = Object.fromEntries(
        Object.entries(parsed).filter(([key, value]) => validColumnIds.has(key) && typeof value === 'number' && Number.isFinite(value))
      ) as ColumnSizingState;
      setColumnSizing(nextSizing);
    } catch {
      setColumnSizing({});
    } finally {
      setHasLoadedColumnSizing(true);
    }
  }, [columnIds, columnSizingStorageKey]);

  useEffect(() => {
    if (!hasLoadedColumnSizing || !columnSizingStorageKey || typeof window === 'undefined') return;

    window.localStorage.setItem(columnSizingStorageKey, JSON.stringify(columnSizing));
  }, [columnSizing, columnSizingStorageKey, hasLoadedColumnSizing]);

  // Recalculate which columns fit the container. Columns are accumulated in priority order using
  // their real sizes (not a uniform estimate) so the visible set never exceeds the container width
  // and the table doesn't scroll horizontally. `showAllColumns` bypasses this and renders everything.
  useEffect(() => {
    const allColumnIds = columns.map(col => getColumnId(col.dataIndex));

    const updateVisibleColumnsEffect = () => {
      if (showAllColumns) {
        setVisibleColumnIds(allColumnIds);
        return;
      }
      if (!tableContainerRef.current) return;

      const containerWidth = tableContainerRef.current.clientWidth;

      // Check if the last column is 'Actions' or 'Action' with interactive elements
      const lastColumn = columns[columns.length - 1];
      const isActionsColumn = !!lastColumn &&
        (lastColumn.title === 'Actions' || lastColumn.title === 'Action') &&
        lastColumn.render !== undefined;

      const prioritizedColumns = [...columns].sort((a, b) => {
        // Always prioritize Actions column if it's the last column
        if (isActionsColumn) {
          if (a === lastColumn) return -1;
          if (b === lastColumn) return 1;
        }

        // Keep ID column and any columns with explicit width as highest priority
        const aIsId = Array.isArray(a.dataIndex) ? a.dataIndex.includes('id') : a.dataIndex === 'id';
        const bIsId = Array.isArray(b.dataIndex) ? b.dataIndex.includes('id') : b.dataIndex === 'id';

        if (aIsId && !bIsId) return -1;
        if (!aIsId && bIsId) return 1;

        // Then prioritize columns with explicit width
        if (a.width && !b.width) return -1;
        if (!a.width && b.width) return 1;

        return 0;
      });

      // Greedily include columns (highest priority first) until the next one would overflow.
      // Using each column's real rendered size keeps the visible set within the container.
      const visible = new Set<string>();
      let usedWidth = 0;
      for (const col of prioritizedColumns) {
        const colId = getColumnId(col.dataIndex);
        const { size } = getColumnSizeConfig(col);
        if (visible.size > 0 && usedWidth + size > containerWidth) {
          break;
        }
        usedWidth += size;
        visible.add(colId);
      }

      // Preserve original column order in the visible list.
      setVisibleColumnIds(allColumnIds.filter(colId => visible.has(colId)));
    };

    updateVisibleColumnsEffect();

    const handleResize = () => {
      updateVisibleColumnsEffect();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [columns, showAllColumns]); // Re-run when columns or show-all change

  // Memoize the initial column configuration to prevent loops
  const columnConfig = useMemo(() => {
    return columns.map((col): { id: string; title: string; dataIndex: string | string[]; hasCustomRender: boolean; visible: boolean } => {
      const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
      return {
        id: colId,
        title: String(col.title), // Convert ReactNode to string
        dataIndex: col.dataIndex,
        hasCustomRender: !!col.render,
        visible: visibleColumnIds.includes(colId)
      };
    });
  }, [columns, visibleColumnIds]);

  // Register with UI reflection system with stable references
  const updateMetadata = useRegisterUIComponent<DataTableComponent>({
    id: id ? `${id}-table` : '__skip_registration_table',
    type: 'dataTable',
    columns: columnConfig,
    pagination: {
      enabled: pagination,
      currentPage,
      pageSize,
      totalItems: totalItems ?? safeData.length,
      totalPages: Math.ceil((totalItems ?? safeData.length) / pageSize)
    },
    rowCount: safeData.length,
    visibleRows: safeData.slice(0, pageSize).map((row): { id: string; values: Record<string, unknown> } => ({
      id: ('id' in row) ? (row as { id: string }).id : '',
      values: row as Record<string, unknown>
    })),
    isEditable: !!editableConfig
  });

  // Create stable column definitions, filtering out columns that shouldn't be visible
  const tableColumns = useMemo<ColumnDef<T>[]>(
    () =>
      columns
        .filter(col => {
          const colId = getColumnId(col.dataIndex);
          return visibleColumnIds.includes(colId);
        })
        .map((col): ColumnDef<T> => {
          const sizing = getColumnSizeConfig(col);
          return {
            id: getColumnId(col.dataIndex),
            accessorFn: (row) => getNestedValue(row, col.dataIndex),
            header: () => col.title,
            cell: (info) => col.render ? col.render(info.getValue(), info.row.original, info.row.index) : info.getValue(),
            sortingFn: caseInsensitiveSort,
            enableSorting: col.sortable !== false,
            enableResizing: true,
            size: sizing.size,
            minSize: sizing.minSize,
            maxSize: sizing.maxSize,
          };
        }),
    [columns, visibleColumnIds]
  );

  const [{ pageIndex, pageSize: currentPageSize }, setPagination] = React.useState({
    pageIndex: currentPage - 1,
    pageSize,
  });

  // Keep internal pagination state synced with props
  React.useEffect(() => {
    setPagination(prev => ({
      ...prev,
      pageIndex: currentPage - 1,
      pageSize: pageSize
    }));
  }, [currentPage, pageSize]);

  // Calculate total pages based on totalItems if provided, otherwise use data length
  const total = totalItems ?? safeData.length;
  const totalPages = Math.ceil(total / currentPageSize);

  // Manage sorting state - filter to only include columns that exist
  const [sorting, setSorting] = React.useState<SortingState>(() => {
    if (manualSorting && sortBy) {
      return [{
        id: sortBy,
        desc: sortDirection === 'desc'
      }];
    }
    if (initialSorting && initialSorting.length > 0) {
      // Filter to only include sorting for columns that exist
      return initialSorting.filter(sort =>
        visibleColumnIds.includes(sort.id)
      );
    }
    return [];
  });

  // Update sorting state when props change (for manual sorting)
  React.useEffect(() => {
    if (manualSorting && sortBy) {
      setSorting([
        {
          id: sortBy,
          desc: sortDirection === 'desc'
        }
      ]);
    }
  }, [manualSorting, sortBy, sortDirection]);

  React.useEffect(() => {
    if (!manualSorting) {
      // Always filter sorting to only include visible columns
      setSorting(prev => {
        const filteredSorting = prev.filter(sort => visibleColumnIds.includes(sort.id));
        // If current sorting became invalid, try to use initialSorting
        if (filteredSorting.length === 0 && initialSorting && initialSorting.length > 0) {
          return initialSorting.filter(sort => visibleColumnIds.includes(sort.id));
        }
        return filteredSorting;
      });
    }
  }, [initialSorting, manualSorting, visibleColumnIds]);

  // Filter sorting to only include columns that exist in visibleColumnIds
  // This prevents TanStack Table errors when columns are hidden due to responsive layout
  const validSorting = useMemo(
    () => sorting.filter(sort => visibleColumnIds.includes(sort.id)),
    [sorting, visibleColumnIds]
  );

  const table = useReactTable({
    data: safeData,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    pageCount: totalPages,
    enableSortingRemoval: false,
    manualSorting,
    state: {
      pagination: {
        pageIndex,
        pageSize: currentPageSize,
      },
      sorting: validSorting,
      columnSizing,
    },
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onColumnSizingChange: setColumnSizing,
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      if (manualSorting && onSortChange) {
        const newSorting = typeof updater === 'function' ? updater(sorting) : updater;
        if (newSorting.length > 0) {
          const { id, desc } = newSorting[0];
          onSortChange(id, desc ? 'desc' : 'asc');
        }
      } else {
        setSorting(updater);
      }
    },
    manualPagination: totalItems !== undefined,
    // Prevent react-table from auto-resetting page index when data changes
    // This is important for client-side pagination where data reference may change
    // but we want to maintain the current page position
    autoResetPageIndex: false,
    meta: {
      editableConfig: props.editableConfig,
    },
  });

  React.useEffect(() => {
    if (!onVisibleRowsChange) {
      return;
    }
    const visibleRows = table.getPaginationRowModel().rows.map(row => row.original as T);
    onVisibleRowsChange(visibleRows);
  }, [
    onVisibleRowsChange,
    table,
    pageIndex,
    currentPageSize,
    safeData,
    sorting,
    visibleColumnIds,
  ]);

  const handleRowClick = (e: React.MouseEvent, row: Row<T>) => {
    // Prevent row click when clicking on interactive elements like dropdowns, buttons, etc.
    const target = e.target as HTMLElement;
    if (
      target.closest('[role="menu"]') ||
      target.closest('[role="menuitem"]') ||
      target.closest('[data-radix-collection-item]') ||
      target.closest('button') ||
      target.closest('input') ||
      target.closest('a')
    ) {
      return;
    }
    if (onRowClick) {
      onRowClick(row.original);
    }
  };

  // Notify parent component of page changes only when the page actually changes
  const lastEmittedPageRef = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!onPageChange) {
      return;
    }

    const nextPage = pageIndex + 1;
    if (lastEmittedPageRef.current === nextPage) {
      return;
    }

    // Skip emitting on first run; parent already has the initial page data
    if (lastEmittedPageRef.current === null) {
      lastEmittedPageRef.current = nextPage;
      return;
    }

    lastEmittedPageRef.current = nextPage;
    onPageChange(nextPage);
  }, [pageIndex, onPageChange]);

  // Update reflection metadata with debouncing to prevent loops
  React.useEffect(() => {
    if (!updateMetadata) return;

    const timeoutId = setTimeout(() => {
      const paginationRowModel = table.getPaginationRowModel();
      const sortingState = table.getState().sorting;
      
      updateMetadata({
        pagination: {
          enabled: pagination,
          currentPage: pageIndex + 1,
          pageSize: currentPageSize,
          totalItems: totalItems ?? safeData.length,
          totalPages: Math.ceil((totalItems ?? safeData.length) / currentPageSize)
        },
        rowCount: safeData.length,
        visibleRows: paginationRowModel.rows.slice(0, 10).map((row): { id: string; values: Record<string, unknown> } => ({
          id: ('id' in row.original) ? (row.original as { id: string }).id : '',
          values: row.original as Record<string, unknown>
        })),
        sortedBy: sortingState[0] ? {
          column: sortingState[0].id,
          direction: sortingState[0].desc ? 'desc' : 'asc'
        } : undefined,
        columns: columnConfig
      });
    }, 100); // Debounce updates by 100ms

    return () => clearTimeout(timeoutId);
  }, [pageIndex, currentPageSize, safeData.length, totalItems, pagination, updateMetadata, columnConfig]);

  return (
    <div
      className="datatable-container overflow-hidden rounded-xl border border-[rgb(var(--color-border-200))] bg-[rgb(var(--color-card))] shadow-sm"
      data-automation-id={id}
      ref={tableContainerRef}
    >
        {showAllColumns ? (
          <Alert variant="info" className="rounded-none border-x-0 border-t-0">
            <AlertDescription className="flex items-center text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {t('dataTable.showingAllColumns', 'Showing all columns; scroll horizontally to see them.')}{' '}
              <button
                type="button"
                onClick={() => setShowAllColumns(false)}
                className="ml-1 font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 hover:opacity-80 focus:outline-none"
              >
                {t('dataTable.showLess', 'Show less')}
              </button>
            </AlertDescription>
          </Alert>
        ) : visibleColumnIds.length < columns.length && (
          <Alert variant="info" className="rounded-none border-x-0 border-t-0">
            <AlertDescription className="flex items-center text-sm">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              {t('dataTable.columnsHidden', {
                count: columns.length - visibleColumnIds.length,
                defaultValue: '{{count}} columns hidden due to limited space.',
              })}{' '}
              <button
                type="button"
                onClick={() => setShowAllColumns(true)}
                className="ml-1 font-medium text-[rgb(var(--color-primary-600))] underline underline-offset-2 hover:opacity-80 focus:outline-none"
              >
                {t('dataTable.showAll', 'Show all')}
              </button>
            </AlertDescription>
          </Alert>
        )}
        <div className="overflow-x-auto [scrollbar-color:rgb(var(--color-border-300))_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[rgb(var(--color-border-300)/0.65)] [&::-webkit-scrollbar-thumb:hover]:bg-[rgb(var(--color-border-400)/0.8)]">
          <table
            className="border-collapse text-[13px]"
            style={{ minWidth: '100%', width: table.getTotalSize() }}
          >
            <thead className="bg-[rgb(var(--color-border-50)/0.55)]">
              {table.getHeaderGroups().map((headerGroup): React.JSX.Element => (
                <tr key={`headergroup_${headerGroup.id}`}>
                  {headerGroup.headers.map((header, headerIndex): React.JSX.Element => {
                    const columnId = header.column.columnDef.id || header.id;
                  const colDef = columns.find(col => {
                    const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
                    return colId === header.column.id;
                  });
                  const isSortable = header.column.getCanSort();
                  const headerTitle = typeof colDef?.title === 'string' ? colDef.title : undefined;
                  return (
                    <th
                      key={`header_${columnId}_${headerIndex}`}
                      id={id ? `${id}-header-${columnId}` : `header-${columnId}`}
                      onClick={isSortable ? (event) => {
                        if (suppressNextHeaderSortClickRef.current) {
                          event.preventDefault();
                          event.stopPropagation();
                          suppressNextHeaderSortClickRef.current = false;
                          if (suppressHeaderSortClickTimeoutRef.current) {
                            clearTimeout(suppressHeaderSortClickTimeoutRef.current);
                            suppressHeaderSortClickTimeoutRef.current = null;
                          }
                          return;
                        }
                        header.column.getToggleSortingHandler()?.(event);
                      } : undefined}
                      className={cn(
                        'group relative h-8 whitespace-nowrap border-b border-r border-[rgb(var(--color-border-100)/0.82)] px-3 py-1.5 text-[12px] font-medium text-[rgb(var(--color-text-500))] transition-colors first:pl-4 last:border-r-0 last:pr-4',
                        isSortable && 'cursor-pointer hover:bg-[rgb(var(--color-border-100)/0.62)] hover:text-[rgb(var(--color-text-700))]',
                        colDef?.headerClassName?.includes('text-center') ? 'text-center' : 'text-left',
                        colDef?.headerClassName ?? ''
                      )}
                      style={{ width: header.getSize() }}
                    >
                        <div className={`flex min-w-0 items-center gap-1.5 ${colDef?.headerClassName?.includes('text-center') ? 'justify-center' : ''}`}>
                          <OverflowTooltipSpan className="min-w-0 overflow-hidden text-ellipsis" text={headerTitle}>{flexRender(header.column.columnDef.header, header.getContext())}</OverflowTooltipSpan>
                          {isSortable && (
                            <span className="shrink-0 text-[rgb(var(--color-text-400))]">
                              {{
                                asc: '↑',
                                desc: '↓',
                              }[header.column.getIsSorted() as string] ?? null}
                            </span>
                          )}
                        </div>
                        {header.column.getCanResize() && headerIndex < headerGroup.headers.length - 1 && (
                          <div
                            role="separator"
                            aria-orientation="vertical"
                            aria-label={`Resize ${typeof colDef?.title === 'string' ? colDef.title : columnId} column`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                            }}
                            onMouseDown={(event) => {
                              event.stopPropagation();
                              suppressNextHeaderSortClick();
                              header.getResizeHandler(document)(event);
                            }}
                            onTouchStart={(event) => {
                              event.stopPropagation();
                              suppressNextHeaderSortClick();
                              header.getResizeHandler(document)(event);
                            }}
                            onDoubleClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              header.column.resetSize();
                              setColumnSizing(prev => {
                                const next = { ...prev };
                                delete next[header.column.id];
                                return next;
                              });
                            }}
                            className={cn(
                              'absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none select-none',
                              'after:absolute after:right-1 after:top-1 after:h-[calc(100%-0.5rem)] after:w-px after:rounded-full after:bg-transparent after:transition-colors',
                              'hover:after:bg-[rgb(var(--color-primary-400))] group-hover:after:bg-[rgb(var(--color-border-300)/0.9)]',
                              header.column.getIsResizing() && 'after:bg-[rgb(var(--color-primary-500))]'
                            )}
                          />
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-[rgb(var(--color-border-100)/0.72)] bg-[rgb(var(--color-card))]">
              {table.getPaginationRowModel().rows.map((row): React.JSX.Element => {
                // Use the id property if it exists in the data, otherwise use row.id
                const rowId = ('id' in row.original) ? (row.original as { id: string }).id : row.id;
                const extraRowClass = typeof rowClassName === 'function' ? rowClassName(row.original as any) : '';
                return (
                  <tr
                    key={`row_${rowId}`}
                    onClick={(e) => handleRowClick(e, row)}
                    className={`
                    bg-[rgb(var(--color-card))]
                    ${onRowClick ? 'hover:bg-[rgb(var(--color-border-50)/0.82)] cursor-pointer' : 'cursor-default'}
                    transition-colors duration-150
                    ${extraRowClass}
                  `}
                  >
                    {row.getVisibleCells().map((cell, cellIndex): React.JSX.Element => {
                      const columnId = cell.column.columnDef.id || cell.column.id;
                      const cellValue = cell.getValue();
                      
                      // For columns with custom renders, use the raw value; for others, convert to string
                      const columnDef = columns.find(col => {
                        const colId = Array.isArray(col.dataIndex) ? col.dataIndex.join('_') : col.dataIndex;
                        return colId === columnId;
                      });
                      
                      // Extract the display text that would actually be shown to the user
                      const cellContent = getDisplayText(columnDef, cellValue, row.original);
                      
                      const cellId = `${id}-cell-${rowId}-${columnId}`;
                      
                      return (
                        <ReflectedTableCell
                          key={`cell_${rowId}_${columnId}_${cellIndex}`}
                          id={cellId}
                          content={cellContent}
                          className={`h-8 max-w-0 overflow-hidden border-r border-[rgb(var(--color-border-100)/0.72)] px-3 py-1.5 text-[13px] leading-4 text-[rgb(var(--color-text-700))] align-middle first:pl-4 last:border-r-0 last:pr-4 ${columnDef?.cellClassName ?? ''}`}
                          style={{ width: cell.column.getSize() }}
                        >
                          <div className="min-w-0">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </div>
                        </ReflectedTableCell>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pagination && safeData.length > 0 && (totalPages > 1 || onItemsPerPageChange) && (
          <div className="border-t border-[rgb(var(--color-border-100)/0.72)]">
            <Pagination
              id={id ? `${id}-pagination` : 'datatable-pagination'}
              currentPage={pageIndex + 1}
              totalItems={total}
              itemsPerPage={currentPageSize}
              onPageChange={(page) => {
                // Update internal state immediately for responsive UI
                // (the useEffect sync from currentPage prop has a 1-render delay)
                setPagination(prev => ({
                  ...prev,
                  pageIndex: page - 1,
                }));
                // Notify parent
                if (onPageChange) {
                  onPageChange(page);
                }
              }}
              onItemsPerPageChange={onItemsPerPageChange}
              itemsPerPageOptions={itemsPerPageOptions || defaultItemsPerPageOptions}
              variant={onItemsPerPageChange ? "clients" : "compact"}
            />
          </div>
        )}
    </div>
  );
};
