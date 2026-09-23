/**
 * Named list views: a saved configuration of a list screen, owned by one user,
 * either private to them or shared with every user who can read that list.
 *
 * The stored document is the `ListViewSettings` envelope. Every list shares the
 * envelope; only `filters` is list-specific, and each list's adapter owns what
 * goes in it.
 */

/** Lists that support named views. Validated server-side against the registry. */
export type ListViewKey = 'tickets' | 'projects' | 'clients' | 'contacts' | 'assets';

export const LIST_VIEW_KEYS: readonly ListViewKey[] = ['tickets', 'projects', 'clients', 'contacts', 'assets'];

export type ListViewVisibility = 'private' | 'shared';

export interface ListViewSort {
  by: string;
  direction: 'asc' | 'desc';
}

export interface ListViewColumns {
  /** Column id → shown. A column absent from the map keeps the list's default. */
  visibility?: Record<string, boolean>;
  /** Sparse order: unlisted columns keep their default order after the listed ones. */
  order?: string[];
  /** Column id → width in px. */
  sizing?: Record<string, number>;
}

export interface ListViewSettings<F = Record<string, unknown>> {
  /** List-specific filter document, typed by the list's adapter. */
  filters?: F;
  sort?: ListViewSort;
  columns?: ListViewColumns;
  /** 0..100, step 10 (tickets only). */
  density?: number;
  pageSize?: number;
}

/** A view as the picker sees it: never includes other users' private views. */
export interface ListViewSummary<F = Record<string, unknown>> {
  view_id: string;
  list_key: ListViewKey;
  name: string;
  visibility: ListViewVisibility;
  owner_user_id: string;
  owner_name: string;
  settings: ListViewSettings<F>;
  schema_version: number;
  created_at: string;
  updated_at: string;
  /** The session user owns this view. */
  isOwner: boolean;
  /** The session user may save changes, rename, re-scope or delete it. */
  canEdit: boolean;
  /** This view is the session user's default for the list. */
  isMyDefault: boolean;
}

/** Everything the picker needs to render for one list. */
export interface ListViewCollection<F = Record<string, unknown>> {
  views: ListViewSummary<F>[];
  /** The session user's default view id for this list, if it is still visible to them. */
  defaultViewId: string | null;
  /** The session user may publish shared views (`list_view:share`). */
  canShare: boolean;
}

export interface CreateListViewInput<F = Record<string, unknown>> {
  name: string;
  visibility: ListViewVisibility;
  settings: ListViewSettings<F>;
}

export interface UpdateListViewInput<F = Record<string, unknown>> {
  name?: string;
  visibility?: ListViewVisibility;
  settings?: ListViewSettings<F>;
}

/** A reference a view held that no longer resolves, reported to the user on apply. */
export interface ListViewDroppedReference {
  /** Filter or column key the reference sat under (e.g. `tags`, `statusId`). */
  field: string;
  /** How many values were dropped from it. */
  count: number;
}

export interface ListViewSanitizeResult<F = Record<string, unknown>> {
  settings: ListViewSettings<F>;
  dropped: ListViewDroppedReference[];
}

/**
 * The client half of a list's participation in named views.
 *
 * `TLive` is the list screen's own live state; the adapter translates between it
 * and the stored envelope. The server half (read permission, strict write schema,
 * schema version, migrations) lives in the list-view registry.
 */
export interface ListViewAdapter<TLive, F = Record<string, unknown>> {
  listKey: ListViewKey;
  /** What gets saved. */
  capture(live: TLive): ListViewSettings<F>;
  /** What gets loaded: the next live state for a view (`null` = the list's baseline). */
  apply(settings: ListViewSettings<F> | null, live: TLive): TLive;
  /** Drops references to entities that no longer exist. Pure; never rewrites the stored view. */
  sanitize(settings: ListViewSettings<F>): ListViewSanitizeResult<F>;
  /** Whether the live state has drifted from a view (`null` = the baseline). */
  differs(live: TLive, settings: ListViewSettings<F> | null): boolean;
}
