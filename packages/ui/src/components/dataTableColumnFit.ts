import { ColumnDefinition } from '@alga-psa/types';

// Fallback design width used to resolve percent widths before the container has been measured.
export const COLUMN_SIZE_BASE_WIDTH = 1800;
const DEFAULT_COLUMN_SIZE = 160;
// Subtracted from the measured container width when resolving percent widths so rounding and
// min-size clamping of narrow columns can't push a 100%-sum table a few pixels past the
// container (which would needlessly hide its last column). minWidth: 100% stretches the slack
// back out when the table renders.
const CONTAINER_GUTTER = 12;
const COMPACT_COLUMN_IDS = new Set(['selection', 'checkbox', 'select', 'actions', 'action', 'tags']);
const SELECTION_COLUMN_IDS = new Set(['selection', 'checkbox', 'select']);

export const getColumnId = (dataIndex: string | string[]): string => (
  Array.isArray(dataIndex) ? dataIndex.join('_') : dataIndex
);

// Percent widths are resolved against the measured container width (percentBase) so a table
// whose columns sum to 100% always fits its container. percentScale normalizes declared
// percentages when they add up to more than 100%.
export interface ColumnLayoutContext {
  percentBase: number;
  percentScale: number;
}

export const DEFAULT_COLUMN_LAYOUT: ColumnLayoutContext = {
  percentBase: COLUMN_SIZE_BASE_WIDTH,
  percentScale: 1,
};

export const getPercentWidth = (width: string | undefined): number | undefined => {
  if (!width) return undefined;

  const trimmed = width.trim();
  if (!trimmed.endsWith('%')) return undefined;

  const percent = Number.parseFloat(trimmed);
  return Number.isFinite(percent) ? percent : undefined;
};

export const getPercentScale = (columns: ColumnDefinition<any>[]): number => {
  const totalPercent = columns.reduce((sum, col) => sum + (getPercentWidth(col.width) ?? 0), 0);
  return totalPercent > 100 ? 100 / totalPercent : 1;
};

export const getColumnLayout = (
  columns: ColumnDefinition<any>[],
  containerWidth: number
): ColumnLayoutContext => ({
  percentBase: containerWidth ? Math.max(containerWidth - CONTAINER_GUTTER, 0) : COLUMN_SIZE_BASE_WIDTH,
  percentScale: getPercentScale(columns),
});

export const parseColumnWidth = (
  width: string | undefined,
  layout: ColumnLayoutContext
): number | undefined => {
  if (!width) return undefined;

  const trimmed = width.trim();
  if (trimmed.endsWith('px')) {
    const px = Number.parseFloat(trimmed);
    return Number.isFinite(px) ? Math.round(px) : undefined;
  }

  const percent = getPercentWidth(trimmed);
  if (percent !== undefined) {
    // Floor so a set of percentages summing to 100% never overshoots the container by rounding.
    return Math.floor(((percent * layout.percentScale) / 100) * layout.percentBase);
  }

  const numeric = Number.parseFloat(trimmed);
  return Number.isFinite(numeric) ? Math.round(numeric) : undefined;
};

const clampSize = (size: number, minSize: number, maxSize: number): number => (
  Math.min(Math.max(size, minSize), maxSize)
);

export const getColumnSizeConfig = (
  column: ColumnDefinition<any>,
  layout: ColumnLayoutContext = DEFAULT_COLUMN_LAYOUT
): { size: number; minSize: number; maxSize: number } => {
  const columnId = getColumnId(column.dataIndex);
  const isPercentWidth = getPercentWidth(column.width) !== undefined;
  const parsedWidth = parseColumnWidth(column.width, layout);
  const titleLength = typeof column.title === 'string' ? column.title.length : 12;

  if (COMPACT_COLUMN_IDS.has(columnId)) {
    // A selection column only ever holds a checkbox — keep it at checkbox width regardless
    // of any declared percentage.
    if (SELECTION_COLUMN_IDS.has(columnId)) {
      return {
        size: clampSize(parsedWidth ?? 48, 44, 56),
        minSize: 44,
        maxSize: 56,
      };
    }
    return {
      size: clampSize(parsedWidth ?? 64, 56, 180),
      minSize: 56,
      maxSize: 180,
    };
  }

  // A percent width expresses a proportion, not a hard size: never let it squeeze a column
  // below the natural width it would get with no width at all. When the natural widths don't
  // fit, columns hide behind the "show all" banner (with horizontal scroll) instead of every
  // column becoming unreadably narrow.
  if (columnId === 'title') {
    const naturalSize = 320;
    const preferred = parsedWidth !== undefined
      ? (isPercentWidth ? Math.max(parsedWidth, naturalSize) : parsedWidth)
      : naturalSize;
    return {
      size: clampSize(preferred, 180, 720),
      minSize: 180,
      maxSize: 720,
    };
  }

  const naturalSize = Math.max(DEFAULT_COLUMN_SIZE, Math.min(280, titleLength * 12 + 72));
  const preferred = parsedWidth !== undefined
    ? (isPercentWidth ? Math.max(parsedWidth, naturalSize) : parsedWidth)
    : naturalSize;
  return {
    size: clampSize(preferred, 96, 520),
    minSize: 96,
    maxSize: 520,
  };
};

export interface ColumnFitResult {
  /** Ids of the columns that fit the container, in the original column order. */
  visibleColumnIds: string[];
  /** The last admitted column may be shrunk into the remaining space instead of hidden. */
  sizeOverrides: Record<string, number>;
}

// Decides which columns fit a container of the given width. Columns are accumulated in
// priority order using their real sizes (not a uniform estimate) so the visible set never
// exceeds the container width and the table doesn't scroll horizontally.
export const computeColumnFit = (
  columns: ColumnDefinition<any>[],
  containerWidth: number,
  layout: ColumnLayoutContext
): ColumnFitResult => {
  const allColumnIds = columns.map(col => getColumnId(col.dataIndex));

  // Check if the last column is an actions column with interactive elements. Detect by column
  // id, with the title check kept as a fallback (titles are localized, ids are not).
  const lastColumn = columns[columns.length - 1];
  const lastColumnId = lastColumn ? getColumnId(lastColumn.dataIndex) : '';
  const isActionsColumn = !!lastColumn && (
    lastColumnId === 'actions' || lastColumnId === 'action' ||
    ((lastColumn.title === 'Actions' || lastColumn.title === 'Action') && lastColumn.render !== undefined)
  );

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
  const visible = new Set<string>();
  const sizeOverrides: Record<string, number> = {};
  let usedWidth = 0;
  for (const col of prioritizedColumns) {
    const colId = getColumnId(col.dataIndex);
    const { size, minSize } = getColumnSizeConfig(col, layout);
    if (visible.size > 0 && usedWidth + size > containerWidth) {
      // The column doesn't fit at its preferred size, but if it can shrink into the
      // remaining space without going below its minimum, show it there instead of hiding it.
      const remaining = containerWidth - usedWidth;
      if (remaining >= minSize) {
        sizeOverrides[colId] = remaining;
        visible.add(colId);
      }
      break;
    }
    usedWidth += size;
    visible.add(colId);
  }

  return {
    visibleColumnIds: allColumnIds.filter(colId => visible.has(colId)),
    sizeOverrides,
  };
};
