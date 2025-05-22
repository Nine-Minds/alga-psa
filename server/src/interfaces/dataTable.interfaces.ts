import { ReactNode } from 'react';

export interface BaseColumnDefinition<T> {
  title: string | ReactNode;
  dataIndex: string | string[];
  width?: string;
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
  /** Initial sorting configuration */
  initialSorting?: { id: string; desc: boolean }[];
}
