// Contract types for the client command center (see ee/docs/plans/2026-07-02-client-command-center).
// Pure types only — no runtime imports. Consumed by the command center UI and by
// clientPulseActions / clientTimelineActions.

export type ClientAttentionFlagKind =
  | 'draft_invoices'
  | 'so_partial'
  | 'ticket_overdue'
  | 'client_waiting'
  | 'rma_open';

export type ClientAttentionSeverity = 'amber' | 'blue' | 'gray';

export type ClientAttentionRefType = 'invoice' | 'sales_order' | 'ticket' | 'rma';

/**
 * Structured attention flag — labels are built client-side (i18n), so the server
 * only ships facts. A flag is emitted only when its condition is genuinely present
 * in the data (D6/D8: no placeholder flags).
 */
export interface ClientAttentionFlag {
  kind: ClientAttentionFlagKind;
  severity: ClientAttentionSeverity;
  count: number;
  amountCents?: number | null;
  refType?: ClientAttentionRefType;
  refId?: string | null;
  refLabel?: string | null;
  /** Days since the triggering moment (overdue since, waiting since, opened since). */
  daysAgo?: number | null;
  /** so_partial only. */
  linesFulfilled?: number | null;
  linesTotal?: number | null;
}

export interface ClientPulsePermissions {
  tickets: boolean;
  billing: boolean;
  inventory: boolean;
  assets: boolean;
  documents: boolean;
}

export interface ClientPulseServiceTicket {
  ticket_id: string;
  ticket_number: string;
  title: string;
  priority_name: string | null;
  priority_color: string | null;
  entered_at: string;
  is_overdue: boolean;
}

export interface ClientPulseService {
  openCount: number;
  oldestOpenDays: number | null;
  overdueCount: number;
  topOpen: ClientPulseServiceTicket[];
}

/** All cents. Buckets by days past due: current (not past due), 1–30, 31–60, >60. */
export interface ClientPulseAging {
  currentCents: number;
  d30Cents: number;
  d60Cents: number;
  d90PlusCents: number;
}

export interface ClientPulseDraftInvoice {
  invoice_id: string;
  invoice_number: string | null;
  totalCents: number;
  created_at: string;
}

export interface ClientPulseMoney {
  aging: ClientPulseAging;
  outstandingTotalCents: number;
  unpaidInvoiceCount: number;
  /** Preview only (newest first, capped at 5) — draftInvoiceCount is the full count. */
  draftInvoices: ClientPulseDraftInvoice[];
  draftInvoiceCount: number;
  activeContractCount: number;
  currencyCode: string;
}

export interface ClientPulseRecentUnit {
  unit_id: string;
  product_name: string;
  serial_number: string | null;
  status: string;
  delivered_at: string | null;
  asset_id: string | null;
}

export interface ClientPulseInstallBase {
  /** null when the caller lacks asset:read (inventory:read alone got them here). */
  managedAssetCount: number | null;
  soldUnitCount: number;
  openRmaCount: number;
  recentUnits: ClientPulseRecentUnit[];
}

export interface ClientPulseContact {
  contact_name_id: string;
  full_name: string;
  role: string | null;
  email: string | null;
  /** Default number from contact_phone_numbers, when one exists. */
  phone: string | null;
  is_default: boolean;
}

export interface ClientPulsePeople {
  totalCount: number;
  top: ClientPulseContact[];
}

export interface ClientPulseLocation {
  location_id: string;
  location_name: string | null;
  address_line1: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  is_default: boolean;
  is_billing: boolean;
  is_shipping: boolean;
}

export interface ClientPulseDocument {
  document_id: string;
  document_name: string;
  updated_at: string;
}

export interface ClientPulseDocuments {
  totalCount: number;
  recent: ClientPulseDocument[];
}

/**
 * Preview of the client's shared BlockNote note (clients.notes_document_id).
 * hasNotes is true only when the note contains actual text — an empty saved
 * doc reads as "no notes" (D6: no zeros-as-insight).
 */
export interface ClientPulseNotes {
  hasNotes: boolean;
  /** Plain text of the first non-empty blocks (preview only, capped). */
  previewLines: string[];
  lastEditedAt: string | null;
}

export interface ClientPulseRecord {
  /** Client website URL, for the identity strip. */
  url: string | null;
  accountManagerName: string | null;
  defaultContactName: string | null;
  inboundDomains: string[];
  taxRegion: string | null;
  clientSince: string | null;
  isInactive: boolean;
}

export interface ClientPulse {
  generatedAt: string;
  permissions: ClientPulsePermissions;
  attention: ClientAttentionFlag[];
  /** Absent when caller lacks ticket:read. */
  service?: ClientPulseService;
  /** Absent when caller lacks billing:read. */
  money?: ClientPulseMoney;
  /** Absent when caller lacks inventory:read. */
  installBase?: ClientPulseInstallBase;
  people: ClientPulsePeople;
  locations: ClientPulseLocation[];
  /** Absent when caller lacks document:read. */
  documents?: ClientPulseDocuments;
  notes: ClientPulseNotes;
  record: ClientPulseRecord;
}

export type ClientTimelineEventType =
  | 'ticket_opened'
  | 'ticket_closed'
  | 'material_added'
  | 'invoice_created'
  | 'invoice_finalized'
  | 'unit_delivered'
  | 'so_created'
  | 'rma_opened'
  | 'rma_closed'
  | 'interaction'
  | 'quote_activity';

export type ClientTimelineRefType =
  | 'ticket'
  | 'invoice'
  | 'sales_order'
  | 'quote'
  | 'rma'
  | 'stock_unit'
  | 'interaction';

export interface ClientTimelineEvent {
  /** `${source}:${pk}[:${suffix}]` — unique and stable, used for cursoring. */
  id: string;
  type: ClientTimelineEventType;
  /** ISO timestamp. */
  occurredAt: string;
  refType: ClientTimelineRefType;
  refId: string;
  /** '#1042', 'INV-000006', 'SO-000001', a serial number, a quote number… */
  refLabel: string;
  /** Human detail straight from data: ticket title, product name, activity description. */
  summary: string;
  amountCents?: number | null;
  status?: string | null;
  /** unit_delivered: the auto-created/linked asset, when present. */
  linkedAssetId?: string | null;
}

export interface ClientTimelineQuery {
  /** Opaque cursor from a previous page. */
  cursor?: string | null;
  types?: ClientTimelineEventType[];
  /** Default 20, max 50. */
  limit?: number;
}

export interface ClientTimelinePage {
  events: ClientTimelineEvent[];
  nextCursor: string | null;
}
