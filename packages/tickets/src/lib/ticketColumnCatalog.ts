// Single source of truth for the ticket-list columns.
//
// Historically the column set and its per-key defaults were re-declared in ~6
// places (the visibility union, the loader's two default blocks, the settings
// toggle list and its two default blocks, the print renderer map). They drifted
// — the "Refined List" redesign updated some lists but not others — which is
// what left stale standalone columns showing for existing tenants. This catalog
// collapses all of that into one declaration that each consumer reads a slice
// of, so the lists can no longer disagree.
//
// Declaration order is the EXPORT order. The interactive list iterates the same
// array, skipping folded columns and rendering `title` once — which reproduces
// the on-screen order — so a single ordering serves both surfaces.
//
// This module is plain data (no JSX, not "use server"), so it is safe to import
// from components, server actions, and the column builder alike.

export type TicketColumnKind =
  // `title`: the hero cell, always shown, not toggleable.
  | 'fixed'
  // `ticket_number`/`category`: folded into the Title cell, never a standalone
  // on-screen column and not user-toggleable. Still emitted as a flat column by
  // the export path.
  | 'folded'
  // Ordinary optional columns: user-toggleable, shown per `defaultVisible`.
  | 'optional'
  // `tags`: rendered inline under the title on screen, as its own column in
  // export. Toggleable via the dedicated "Show Tags" control.
  | 'tags';

export interface TicketColumnSpec {
  /** Stable visibility key persisted in tenant display settings. */
  key: string;
  /** Field on ITicketListItem the column reads (column dataIndex + export key). */
  dataIndex: string;
  kind: TicketColumnKind;
  /** Default on-screen visibility for `optional`/`tags`; folded/fixed are always present. */
  defaultVisible: boolean;
  /** i18n key + fallback for the column header and settings toggle label. */
  titleKey: string;
  titleFallback: string;
}

export const TICKET_COLUMNS = [
  { key: 'ticket_number', dataIndex: 'ticket_number',    kind: 'folded',   defaultVisible: false, titleKey: 'fields.ticketNumber', titleFallback: 'Ticket Number' },
  { key: 'title',         dataIndex: 'title',            kind: 'fixed',    defaultVisible: true,  titleKey: 'fields.title',        titleFallback: 'Title' },
  { key: 'status',        dataIndex: 'status_name',      kind: 'optional', defaultVisible: true,  titleKey: 'fields.status',       titleFallback: 'Status' },
  { key: 'priority',      dataIndex: 'priority_name',    kind: 'optional', defaultVisible: true,  titleKey: 'fields.priority',     titleFallback: 'Priority' },
  { key: 'sla',           dataIndex: 'sla_policy_id',    kind: 'optional', defaultVisible: false, titleKey: 'fields.sla',          titleFallback: 'SLA' },
  { key: 'board',         dataIndex: 'board_name',       kind: 'optional', defaultVisible: true,  titleKey: 'fields.board',        titleFallback: 'Board' },
  { key: 'category',      dataIndex: 'category_name',    kind: 'folded',   defaultVisible: false, titleKey: 'fields.category',     titleFallback: 'Category' },
  { key: 'client',        dataIndex: 'client_name',      kind: 'optional', defaultVisible: true,  titleKey: 'fields.client',       titleFallback: 'Client' },
  { key: 'assigned_to',   dataIndex: 'assigned_to_name', kind: 'optional', defaultVisible: true,  titleKey: 'fields.assignedTo',   titleFallback: 'Assigned To' },
  { key: 'due_date',      dataIndex: 'due_date',         kind: 'optional', defaultVisible: true,  titleKey: 'fields.dueDate',      titleFallback: 'Due Date' },
  { key: 'created',       dataIndex: 'entered_at',       kind: 'optional', defaultVisible: false, titleKey: 'fields.created',      titleFallback: 'Created' },
  { key: 'created_by',    dataIndex: 'entered_by_name',  kind: 'optional', defaultVisible: false, titleKey: 'fields.createdBy',    titleFallback: 'Created By' },
  { key: 'tags',          dataIndex: 'tags',             kind: 'tags',     defaultVisible: true,  titleKey: 'fields.tags',         titleFallback: 'Tags' },
] as const satisfies readonly TicketColumnSpec[];

/** Union of every column key, derived from the catalog so it can't drift. */
export type TicketListColumnKey = (typeof TICKET_COLUMNS)[number]['key'];

/** Columns the user can toggle in display settings (excludes fixed/folded/tags). */
export const TOGGLEABLE_TICKET_COLUMNS = TICKET_COLUMNS.filter((c) => c.kind === 'optional');

/**
 * Resolve a stored (sparse) visibility map into a full one, applying catalog
 * defaults per key. Shared by the loader and the column builder so the default
 * set is defined exactly once.
 */
export function resolveTicketColumnVisibility(
  stored?: Partial<Record<TicketListColumnKey, boolean>>,
): Record<TicketListColumnKey, boolean> {
  const out = {} as Record<TicketListColumnKey, boolean>;
  for (const col of TICKET_COLUMNS) {
    out[col.key] = stored?.[col.key] ?? col.defaultVisible;
  }
  return out;
}
