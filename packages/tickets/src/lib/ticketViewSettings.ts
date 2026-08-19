import type { ITicketListFilters } from '@alga-psa/types';
import {
  resolveTicketColumnOrder,
  resolveTicketColumnVisibility,
  type TicketListColumnKey,
} from './ticketColumnCatalog';

/**
 * The missing resolution layer under board-level view configuration.
 *
 * A board's view is a *document*, not a bag of columns, and the same document
 * already exists one layer up at `tenant_settings.ticket_display_settings.list`.
 * This module is the single place the three layers are stacked:
 *
 *     boards.list_view_settings  →  tenant ticket_display_settings.list  →  TICKET_COLUMNS catalog
 *
 * Every surface resolves through here — the dashboard, the board settings
 * preview, the tenant display-settings screen — so a board's view and the
 * tenant's view can never be computed two different ways. The client-portal and
 * MSP client/contact ticket surfaces get tenant-only resolution by simply not
 * passing a `board`, which is the layering expressing scope rather than a
 * branch at each call site.
 *
 * Plain data: no JSX, not "use server", so it is importable from components,
 * server actions and the column builder alike (matching ticketColumnCatalog.ts).
 */

/** Density slider default when neither board nor tenant expresses one. */
export const TICKET_VIEW_DENSITY_DEFAULT = 50;
/** Density slider step; a stored value is snapped to it on resolve. */
export const TICKET_VIEW_DENSITY_STEP = 10;

export interface TicketViewSettings {
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  /** Sparse: unlisted catalog keys keep catalog order and are appended. */
  columnOrder?: TicketListColumnKey[];
  tagsInlineUnderTitle?: boolean;
  /** 0..100, step 10 — matches the existing density slider. */
  densityLevel?: number;
  /** Captured list filters; CAPTURE_EXCLUDED_FILTER_KEYS are stripped before persist. */
  filters?: Partial<ITicketListFilters>;
}

/** A view with every layer applied — nothing optional left to decide. */
export interface ResolvedTicketViewSettings {
  columnVisibility: Record<TicketListColumnKey, boolean>;
  columnOrder: TicketListColumnKey[];
  tagsInlineUnderTitle: boolean;
  densityLevel: number;
  filters: Partial<ITicketListFilters>;
}

/**
 * Filter keys never captured into a saved view.
 *
 * A single exported constant so capture and every test of capture read the same
 * list — the alternative is an inline literal that drifts the first time a key
 * is added.
 *
 * - board scope (`boardId`/`boardIds`/`excludeBoardIds`/`boardFilterState`) *is*
 *   the tab. Capturing it would let a board's default view scope that board to a
 *   different board — a saved view that navigates you away from itself.
 * - `searchQuery` is transient. A stray search string must not become permanent
 *   for every user of the board.
 */
export const CAPTURE_EXCLUDED_FILTER_KEYS = [
  'boardId',
  'boardIds',
  'excludeBoardIds',
  'boardFilterState',
  'searchQuery',
] as const satisfies readonly (keyof ITicketListFilters)[];

export type CaptureExcludedFilterKey = (typeof CAPTURE_EXCLUDED_FILTER_KEYS)[number];

const EXCLUDED_KEY_SET: ReadonlySet<string> = new Set(CAPTURE_EXCLUDED_FILTER_KEYS);

/**
 * Boolean filters whose `false` is the *absence* of a constraint rather than a
 * constraint of its own. Capturing them as `false` would store "do not include
 * unassigned" as a positive assertion — indistinguishable in the document from
 * a deliberate choice, and enough on its own to make a board that has been
 * configured with nothing at all compare as different from its own defaults.
 *
 * `showOpenOnly` is deliberately NOT in this list: it is derived from statusId
 * and `false` there genuinely means "show closed too".
 */
const NO_OP_WHEN_FALSE: ReadonlySet<string> = new Set(['includeUnassigned', 'assignedToMe']);

function normalizeDensityLevel(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped / TICKET_VIEW_DENSITY_STEP) * TICKET_VIEW_DENSITY_STEP;
}

/**
 * Layer the board document over the tenant document over the catalog.
 *
 * Merging is **group-level, not per-key**: if the board defines
 * `columnVisibility` at all, it replaces the tenant's map entirely rather than
 * deep-merging into it. Capture always writes a complete map, so a per-key merge
 * would buy no expressiveness and would make "the board hides Client" ambiguous
 * with "the board has not decided about Client". `filters` follows the same rule
 * — a board that defines filters owns the whole filter set.
 *
 * A board with `list_view_settings = NULL` (or an absent group inside it) falls
 * through cleanly to the tenant layer, which is what makes "reset to tenant
 * default" a single NULL write rather than a copy of the tenant document.
 */
export function resolveTicketViewSettings(params: {
  board?: TicketViewSettings | null;
  tenant?: TicketViewSettings | null;
}): ResolvedTicketViewSettings {
  const { board, tenant } = params;

  const pick = <K extends keyof TicketViewSettings>(key: K): TicketViewSettings[K] | undefined => {
    const fromBoard = board?.[key];
    if (fromBoard !== undefined && fromBoard !== null) {
      return fromBoard;
    }
    const fromTenant = tenant?.[key];
    return fromTenant !== undefined && fromTenant !== null ? fromTenant : undefined;
  };

  return {
    columnVisibility: resolveTicketColumnVisibility(pick('columnVisibility')),
    columnOrder: resolveTicketColumnOrder(pick('columnOrder')),
    tagsInlineUnderTitle: pick('tagsInlineUnderTitle') ?? true,
    densityLevel: normalizeDensityLevel(pick('densityLevel')) ?? TICKET_VIEW_DENSITY_DEFAULT,
    filters: pick('filters') ?? {},
  };
}

/**
 * The live view, reduced to what is worth storing.
 *
 * Capture reads the real list rather than a parallel settings form, so every
 * filter added to ITicketListFilters in future is defaultable for free — there
 * is no second UI that must be taught about it. That is also why the exclusion
 * list is a deny-list: a new key is captured unless someone decides it should
 * not be.
 */
export function captureTicketViewSettings(view: {
  filters?: Partial<ITicketListFilters>;
  columnVisibility?: Partial<Record<TicketListColumnKey, boolean>>;
  columnOrder?: TicketListColumnKey[];
  tagsInlineUnderTitle?: boolean;
  densityLevel?: number;
}): TicketViewSettings {
  const filters: Partial<ITicketListFilters> = {};
  for (const [key, value] of Object.entries(view.filters ?? {})) {
    if (EXCLUDED_KEY_SET.has(key)) continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (value === false && NO_OP_WHEN_FALSE.has(key)) continue;
    (filters as Record<string, unknown>)[key] = value;
  }

  const captured: TicketViewSettings = { filters };
  if (view.columnVisibility) {
    captured.columnVisibility = resolveTicketColumnVisibility(view.columnVisibility);
  }
  if (view.columnOrder) {
    captured.columnOrder = resolveTicketColumnOrder(view.columnOrder);
  }
  if (typeof view.tagsInlineUnderTitle === 'boolean') {
    captured.tagsInlineUnderTitle = view.tagsInlineUnderTitle;
  }
  const density = normalizeDensityLevel(view.densityLevel);
  if (density !== undefined) {
    captured.densityLevel = density;
  }
  return captured;
}

/**
 * Ids inside a captured filter set that no longer resolve are dropped.
 *
 * JSONB cannot foreign-key-check a `status_id`, so integrity is enforced on
 * *read* instead — the established pattern on this surface, where
 * `resolveInitialBoardTab` already drops a stored board that no longer exists
 * and `buildTicketStatusFilterOptions` already drops a statusId when switching
 * to a board that lacks it. Dropping is strictly better than the alternative: a
 * dead statusId applied verbatim produces an empty list on a board that has
 * tickets, which reads as a bug rather than as stale configuration.
 *
 * Sentinel values ('all', the open-status pseudo-filter) are never ids, so they
 * are passed through untouched by only validating values present in the
 * corresponding known-id set.
 */
export function validateCapturedFilters(
  filters: Partial<ITicketListFilters> | undefined,
  known: {
    statusIds?: readonly string[];
    priorityIds?: readonly string[];
    categoryIds?: readonly string[];
    clientIds?: readonly string[];
    userIds?: readonly string[];
    teamIds?: readonly string[];
    tags?: readonly string[];
  },
  /** Values that are pseudo-filters rather than ids and must survive validation. */
  sentinels: readonly string[] = [],
): Partial<ITicketListFilters> {
  if (!filters) return {};

  const sentinelSet = new Set(sentinels);
  const out: Partial<ITicketListFilters> = { ...filters };

  const keepScalar = (value: string | undefined, allowed: readonly string[] | undefined) => {
    if (value === undefined) return undefined;
    if (sentinelSet.has(value)) return value;
    // An unknown universe means "cannot validate", which must not mean "drop".
    if (!allowed) return value;
    return allowed.includes(value) ? value : undefined;
  };

  const keepList = (values: string[] | undefined, allowed: readonly string[] | undefined) => {
    if (!values) return undefined;
    if (!allowed) return values;
    const kept = values.filter(value => sentinelSet.has(value) || allowed.includes(value));
    return kept.length > 0 ? kept : undefined;
  };

  out.statusId = keepScalar(filters.statusId, known.statusIds);
  out.priorityId = keepScalar(filters.priorityId, known.priorityIds);
  out.categoryId = keepScalar(filters.categoryId, known.categoryIds);
  out.clientId = keepScalar(filters.clientId, known.clientIds);
  out.categoryIds = keepList(filters.categoryIds, known.categoryIds);
  out.excludeCategoryIds = keepList(filters.excludeCategoryIds, known.categoryIds);
  out.assignedToIds = keepList(filters.assignedToIds, known.userIds);
  out.assignedTeamIds = keepList(filters.assignedTeamIds, known.teamIds);
  out.tags = keepList(filters.tags, known.tags);

  for (const key of Object.keys(out) as (keyof ITicketListFilters)[]) {
    if (out[key] === undefined) {
      delete out[key];
    }
  }
  return out;
}

/**
 * The filter set produced by arriving at a board tab.
 *
 * Arrival is a *replacement*, not a refinement: the board's stored filters
 * replace whatever the previous board's view left behind, because the whole
 * premise is that a board looks like itself when you go there. Merging onto the
 * previous state instead would make a board's appearance depend on where you
 * came from — the exact property the tab strip was supposed to remove.
 *
 * Board scope always comes from `boardSelection` and never from `viewFilters`:
 * capture strips the scope keys, and this strip is the belt to that braces, so
 * even a hand-written document cannot make a board's default view navigate to a
 * different board.
 */
export function buildBoardArrivalFilters(params: {
  /** The list's neutral starting state (status open, priority all, …). */
  baseline: Partial<ITicketListFilters>;
  /** Board scope + status reconciliation from buildBoardSelectionFilterUpdate. */
  boardSelection: Partial<ITicketListFilters>;
  /** The resolved view's filters, already validated-on-read. */
  viewFilters: Partial<ITicketListFilters>;
}): Partial<ITicketListFilters> {
  const { baseline, boardSelection, viewFilters } = params;

  const scopedView: Partial<ITicketListFilters> = { ...viewFilters };
  for (const key of CAPTURE_EXCLUDED_FILTER_KEYS) {
    delete scopedView[key];
  }

  return { ...baseline, ...boardSelection, ...scopedView };
}

/**
 * True when the live view has drifted from what is saved — drives the dot on the
 * `View ▾` control. Compared on the *captured* projection of both sides so the
 * excluded keys (board scope, search) can never make a view look dirty.
 */
export function ticketViewDiffersFromSaved(
  live: TicketViewSettings,
  saved: TicketViewSettings | null | undefined,
): boolean {
  const normalize = (value: TicketViewSettings | null | undefined): string =>
    JSON.stringify(sortKeysDeep(captureTicketViewSettings(value ?? {})));
  return normalize(live) !== normalize(saved);
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(key => [key, sortKeysDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}
