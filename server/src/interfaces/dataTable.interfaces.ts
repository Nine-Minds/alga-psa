import { ReactNode } from 'react';

export interface BaseColumnDefinition<T> {
  title: string | ReactNode;
  dataIndex: string | string[];
  width?: string;
  /** Optional class for header th */
  headerClassName?: string;
  /** Optional class for body td */
  cellClassName?: string;
  /** Whether this column is sortable (default: true) */
  sortable?: boolean;
}

export interface RenderColumnDefinition<T, V> extends BaseColumnDefinition<T> {
  render: (value: V, record: T, index: number) => ReactNode;
}

export interface SimpleColumnDefinition<T> extends BaseColumnDefinition<T> {
  render?: never;
}

export type ColumnDefinition<T> = SimpleColumnDefinition<T> | RenderColumnDefinition<T, any>;

export interface EditableConfig {
  editing: boolean;
  onEdit?: (value: string) => void;
}

export interface DataTableProps<T> {
  data: T[];
  columns: ColumnDefinition<T>[];
  pagination?: boolean;
  onRowClick?: (record: T) => void;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  pageSize?: number;
  totalItems?: number;
  editableConfig?: EditableConfig;
  /** Custom class name for table rows */
  rowClassName?: (record: T) => string;
  /** Callback invoked when the set of visible rows (current page) changes */
  onVisibleRowsChange?: (rows: T[]) => void;
  /** Initial sorting configuration */
  initialSorting?: { id: string; desc: boolean }[];
  /** Enable manual (server-side) sorting */
  manualSorting?: boolean;
  /** Current sort column identifier for server-side sorting */
  sortBy?: string;
  /** Current sort direction for server-side sorting */
  sortDirection?: 'asc' | 'desc';
  /** Callback invoked when sort configuration changes */
  onSortChange?: (sortBy: string, sortDirection: 'asc' | 'desc') => void;
  /** Callback invoked when items per page changes */
  onItemsPerPageChange?: (itemsPerPage: number) => void;
  /**
   * Options for items per page dropdown.
   * Defaults to [10, 25, 50, 100] for list/table views if not provided.
   * Use custom options for grid views (e.g., [9, 18, 27, 36]) or special cases.
   */
  itemsPerPageOptions?: Array<{ value: string; label: string }>;
}
