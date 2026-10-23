import type {
  ListViewAdapter,
  ListViewKey,
  ListViewSanitizeResult,
  ListViewSettings,
  ListViewSort,
} from '@alga-psa/types';
import {
  DroppedReferenceCollector,
  compactFilters,
  differsByCapture,
  withoutUndefined,
} from './adapterHelpers';

/**
 * The adapter for an ordinary table list: a flat filter object, a sort, a page
 * size, column widths and (optionally) column visibility.
 *
 * Every non-ticket list that adopts named views has exactly this shape, so the
 * screen supplies its filter keys, its defaults and how to drop dead references,
 * and nothing else.
 */

export interface TableListLiveState<F extends object> {
  filters: F;
  sort: ListViewSort;
  pageSize: number;
  columnSizing?: Record<string, number>;
  /** Only for lists that let the user choose columns. */
  columnVisibility?: Record<string, boolean>;
  /** Only for lists that let the user choose columns: their order, by column id. */
  columnOrder?: string[];
}

export interface TableListDefaults<F extends object> {
  filters: F;
  sort: ListViewSort;
  pageSize: number;
  columnVisibility?: Record<string, boolean>;
  columnOrder?: string[];
}

export interface TableListViewAdapterOptions<F extends object> {
  listKey: ListViewKey;
  /** The keys a view stores; anything else on the live filter object is not view state. */
  filterKeys: readonly (keyof F & string)[];
  /** The list with nothing applied. */
  defaults: TableListDefaults<F>;
  /** Boolean filters whose `false` means "no constraint". */
  falseIsNoOp?: readonly (keyof F & string)[];
  /** Drop references that no longer resolve, recording them on the collector. */
  sanitizeFilters?: (filters: F, collector: DroppedReferenceCollector) => F;
  /** Capture and apply column visibility and order (lists with a column chooser). */
  capturesColumns?: boolean;
}

export function pickFilters<F extends object>(
  filters: object | undefined,
  keys: readonly (keyof F & string)[],
  falseIsNoOp: readonly string[] = [],
): F {
  const source = (filters ?? {}) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return compactFilters(picked, { falseIsNoOp }) as F;
}

export function createTableListViewAdapter<F extends object>(
  options: TableListViewAdapterOptions<F>,
): ListViewAdapter<TableListLiveState<F>, F> {
  const { defaults, filterKeys } = options;
  const falseIsNoOp = (options.falseIsNoOp ?? []) as readonly string[];

  const capture = (live: TableListLiveState<F>): ListViewSettings<F> => ({
    filters: pickFilters<F>(live.filters, filterKeys, falseIsNoOp),
    sort: { ...live.sort },
    columns: withoutUndefined({
      visibility: options.capturesColumns && live.columnVisibility
        ? { ...live.columnVisibility }
        : undefined,
      order: options.capturesColumns && live.columnOrder ? [...live.columnOrder] : undefined,
      sizing: live.columnSizing && Object.keys(live.columnSizing).length > 0
        ? { ...live.columnSizing }
        : undefined,
    }),
    pageSize: live.pageSize,
  });

  const apply = (settings: ListViewSettings<F> | null, live: TableListLiveState<F>): TableListLiveState<F> => {
    if (!settings) {
      return {
        filters: { ...defaults.filters },
        sort: { ...defaults.sort },
        // The baseline keeps the user's own page size rather than resetting it.
        pageSize: live.pageSize,
        columnSizing: undefined,
        columnVisibility: defaults.columnVisibility ? { ...defaults.columnVisibility } : undefined,
        columnOrder: defaults.columnOrder ? [...defaults.columnOrder] : undefined,
      };
    }
    return {
      // A view replaces the whole filter set: whatever it does not name is unset.
      filters: { ...defaults.filters, ...pickFilters<F>(settings.filters, filterKeys, falseIsNoOp) },
      sort: settings.sort ? { ...settings.sort } : { ...defaults.sort },
      pageSize: settings.pageSize ?? defaults.pageSize,
      columnSizing: settings.columns?.sizing ? { ...settings.columns.sizing } : undefined,
      columnVisibility: options.capturesColumns && settings.columns?.visibility
        ? { ...(defaults.columnVisibility ?? {}), ...settings.columns.visibility }
        : defaults.columnVisibility ? { ...defaults.columnVisibility } : undefined,
      columnOrder: options.capturesColumns && settings.columns?.order
        ? [...settings.columns.order]
        : defaults.columnOrder ? [...defaults.columnOrder] : undefined,
    };
  };

  const sanitize = (settings: ListViewSettings<F>): ListViewSanitizeResult<F> => {
    if (!options.sanitizeFilters || !settings.filters) {
      return { settings, dropped: [] };
    }
    const collector = new DroppedReferenceCollector();
    const filters = withoutUndefined(options.sanitizeFilters({ ...settings.filters }, collector));
    return { settings: { ...settings, filters }, dropped: collector.dropped };
  };

  return {
    listKey: options.listKey,
    capture,
    apply,
    sanitize,
    differs: (live, settings) => differsByCapture(capture, apply, live, settings),
  };
}
