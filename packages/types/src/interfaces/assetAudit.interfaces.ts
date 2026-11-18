/**
 * Site audits (mobile 2.0 FR15–FR18, web surfaces).
 *
 * A run snapshots the assets expected at a client location, collects marks as
 * the walk proceeds, and on completion turns the gap between expected and
 * present into `missing` items. The records live in `asset_audits` /
 * `asset_audit_items`; both mobile (v1 REST) and the MSP web app (server
 * actions) read them through the same service, so the shapes are shared here
 * rather than duplicated per surface.
 */

export type AssetAuditStatus = 'in_progress' | 'completed' | 'cancelled';
export type AssetAuditItemResult = 'expected' | 'present' | 'missing' | 'unexpected';
export type AssetAuditItemMethod = 'scan' | 'manual' | 'register';

export interface AssetAuditRecord {
  audit_id: string;
  tenant: string;
  client_id: string;
  location_id: string | null;
  status: AssetAuditStatus;
  started_by: string;
  started_at: string;
  completed_at: string | null;
  expected_count: number;
  present_count: number;
  missing_count: number;
  unexpected_count: number;
  /** Asset status slugs in scope; null or empty means every status. */
  statuses?: string[] | null;
  notes?: string | null;
  client_name?: string | null;
  location_name?: string | null;
  /** Joined on read, for the list's "Started by" column. */
  started_by_name?: string | null;
}

export interface AssetAuditItemRecord {
  asset_id: string;
  result: AssetAuditItemResult;
  method: AssetAuditItemMethod | null;
  marked_at: string | null;
  marked_by: string | null;
  asset_name?: string | null;
  asset_tag?: string | null;
  serial_number?: string | null;
  /** Registry slug (built-in or tenant `asset_type_registry`), joined on read. */
  asset_type?: string | null;
  location_id?: string | null;
  location?: string | null;
  client_id?: string | null;
  /** Joined on read, for the items table's "Marked by" column. */
  marked_by_name?: string | null;
}

export interface AssetAuditWithItems extends AssetAuditRecord {
  items: AssetAuditItemRecord[];
}

/**
 * Shared list filters. `started_from` / `started_to` are ISO timestamps: the
 * web UI turns the picked calendar days into day boundaries in the viewer's
 * time zone before sending them, so a day filter means the viewer's day.
 */
export interface AssetAuditListFilters {
  page?: number;
  limit?: number;
  client_id?: string;
  location_id?: string;
  /** Only audits scoped to "assets with no location". Ignores `location_id`. */
  no_location?: boolean;
  status?: AssetAuditStatus;
  started_from?: string;
  started_to?: string;
}

export interface AssetAuditListPage {
  audits: AssetAuditRecord[];
  total: number;
}

/** The scope preview behind the start dialog's live expected count. */
export interface AssetAuditScopePreview {
  expected_count: number;
}
