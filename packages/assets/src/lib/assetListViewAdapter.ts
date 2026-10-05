import type { ListViewAdapter, ListViewSort } from '@alga-psa/types';
import {
  createTableListViewAdapter,
  type AssetListViewFilters,
  type TableListLiveState,
} from '@alga-psa/list-views';

/**
 * Named views for the Assets list: its filter chips, sort, page size, column
 * widths and the column chooser (which columns show, in which order).
 */

export type AssetListLiveState = TableListLiveState<AssetListViewFilters>;

export const DEFAULT_ASSET_LIST_SORT: ListViewSort = { by: 'created_at', direction: 'desc' };

/**
 * The column chooser keeps an ordered list of visible column keys; a view
 * stores it as a visibility map over every known column plus that order.
 */
export function assetColumnsToView(
  visibleColumnIds: readonly string[],
  allColumnIds: readonly string[],
): { columnVisibility: Record<string, boolean>; columnOrder: string[] } {
  const visible = new Set(visibleColumnIds);
  return {
    columnVisibility: Object.fromEntries(allColumnIds.map((id) => [id, visible.has(id)])),
    columnOrder: [...visibleColumnIds],
  };
}

/**
 * Back to the chooser's ordered list: the stored order first, then any other
 * column the view marks visible, in library order. Unknown (retired) columns
 * are ignored; a view that would show nothing falls back to the defaults.
 */
export function assetColumnsFromView<K extends string>(
  columnVisibility: Record<string, boolean> | undefined,
  columnOrder: readonly string[] | undefined,
  allColumnIds: readonly K[],
  fallback: readonly K[],
): K[] {
  if (!columnVisibility && !columnOrder) return [...fallback];
  const order = columnOrder ?? [];
  const isVisible = (id: string) => (columnVisibility ? columnVisibility[id] === true : order.includes(id));
  const visible = allColumnIds.filter(isVisible);
  const ordered = order.filter((id): id is K => (visible as readonly string[]).includes(id));
  const rest = visible.filter((id) => !ordered.includes(id));
  const result = [...ordered, ...rest];
  return result.length > 0 ? result : [...fallback];
}

export function createAssetListViewAdapter(context: {
  defaultPageSize: number;
  defaultColumns: { columnVisibility: Record<string, boolean>; columnOrder: string[] };
  /** Undefined while clients are loading: nothing is dropped. */
  knownClientIds?: ReadonlySet<string>;
}): ListViewAdapter<AssetListLiveState, AssetListViewFilters> {
  return createTableListViewAdapter<AssetListViewFilters>({
    listKey: 'assets',
    filterKeys: ['statuses', 'types', 'clientIds', 'agentStatuses', 'rmmManaged'],
    defaults: {
      filters: {},
      sort: DEFAULT_ASSET_LIST_SORT,
      pageSize: context.defaultPageSize,
      columnVisibility: context.defaultColumns.columnVisibility,
      columnOrder: context.defaultColumns.columnOrder,
    },
    capturesColumns: true,
    sanitizeFilters: (filters, collector) => ({
      ...filters,
      clientIds: collector.keepList('clientIds', filters.clientIds, context.knownClientIds),
    }),
  });
}
