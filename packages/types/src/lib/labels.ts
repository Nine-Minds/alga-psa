import type { IUserWithRoles } from '../interfaces/auth.interfaces';
import type { RecordEntityType } from './recordLinks';

/**
 * Label contracts shared by the label renderer (billing) and the record owners
 * (tickets, assets, inventory). Billing never imports those packages and they never import
 * billing: each owner implements `LabelViewModelProvider` and the server route (the composition
 * root) wires providers to the renderer.
 */

/** Which standard label layout a record is printed with. */
export const LABEL_CLASSES = ['ticket-work-tag', 'asset-identity', 'stock-unit-identity', 'staging-container', 'rma-work-tag'] as const;
export type LabelClass = (typeof LABEL_CLASSES)[number];

export function isLabelClass(value: unknown): value is LabelClass {
  return typeof value === 'string' && (LABEL_CLASSES as readonly string[]).includes(value);
}

/**
 * Fields a tenant label template may hide (`metadata.labelSettings.hiddenFields`). Never includes
 * `url` or `identifier`: a label must always carry its QR and its human-readable identifier.
 */
export const LABEL_HIDEABLE_FIELDS = [
  'clientName',
  'title',
  'detail',
  'secondaryIdentifier',
  'serialSuffix',
  'assetSerialNumber',
  'ticketDescription',
  'custodyLocation',
  'nextAction',
  'tenantLogo',
  'tenantName',
] as const;
export type LabelHideableField = (typeof LABEL_HIDEABLE_FIELDS)[number];

export interface TemplateLabelSettings {
  hiddenFields?: LabelHideableField[];
  // A `ticket-work-tag` template whose declared page (printSettings.paperPreset / customPageSize)
  // is Letter- or A4-sized portrait paper prints as a full-page customer worksheet: the label
  // line-budget rules that trim fields to a 4 x 2 in tag do not apply, and the print dialog
  // defaults to the paper the template asks for. The page size is the only gate.
}

/** The record type each label class prints. */
export const LABEL_CLASS_ENTITY_TYPE: Record<LabelClass, RecordEntityType> = {
  'ticket-work-tag': 'ticket',
  'asset-identity': 'asset',
  'stock-unit-identity': 'stock_unit',
  'staging-container': 'staging_container',
  'rma-work-tag': 'rma',
};

/**
 * The asset block a full-page ticket worksheet prints. Only ever filled behind the asset read check,
 * for the ONE asset the label is about (the dialog pick, or the ticket's single affected asset).
 * Free-text spec lines are pre-composed ("Intel Core i7-12700 / 12 cores", "16 GB", "SSD 512 GB") so
 * templates never concatenate. Never credentials, notes or notes-like columns.
 */
export interface LabelLinkedAssetInfo {
  assetId: string;
  /** The `assets.name` display name — the tag line only carries the `asset_tag`. */
  name: string | null;
  /** Manufacturer and model are first-class columns on `assets` (procurement migration). */
  manufacturer: string | null;
  model: string | null;
  /** "Windows 11 Pro 23H2" style, composed from the type extension row (workstation/server/mobile). */
  osLine: string | null;
  /** "Intel Core i7-12700 / 12 cores" style, composed from the type extension row. */
  cpuLine: string | null;
  /** "16 GB" style, composed from the type extension row. */
  ramLine: string | null;
  /** "SSD 512 GB" style, composed from the type extension row (servers summarise their storage_config). */
  storageLine: string | null;
}

export interface LabelTenantClient {
  name: string | null;
  /** A `data:` URL (inlined by the PDF service so Puppeteer needs no session), or null. */
  logoUrl: string | null;
  /** Text brand line: the name, but only when there is no logo. Filled by the renderer. */
  brandText?: string | null;
}

/**
 * One uniform shape for every label class (decision: one generic `work-tag` document type).
 * Fields a class has no use for are null. Ordinary tags exclude comments, credentials and full
 * serial numbers; the explicitly selected Letter worksheet may include the ticket description and
 * full serial of its authorized linked asset.
 */
export interface LabelViewModel {
  labelClass: LabelClass;
  entityType: RecordEntityType;
  recordId: string;
  /** Canonical absolute `recordUrl`: the ONLY content encoded in the QR code. */
  url: string;
  /** Human-readable identifier: ticket number, asset tag, serial-number-less unit code. */
  identifier: string;
  /** Value for the optional Code 128 (a short, printable-ASCII identifier). */
  code128Value: string | null;
  title: string | null;
  clientName: string | null;
  /** Free detail line: work reason (ticket), asset type (asset), product name (stock unit). */
  detail: string | null;
  /** Linked asset tag (ticket work tag). */
  secondaryIdentifier: string | null;
  /** Last characters of the serial number, never the whole serial. */
  serialSuffix: string | null;
  /** Full serial of the authorized linked asset, supplied only for a Letter ticket worksheet. */
  assetSerialNumber?: string | null;
  /** Plain-text ticket description, supplied only for a Letter ticket worksheet. */
  ticketDescription?: string | null;
  /**
   * Ticket work tag only: where held client equipment is ("Main Office / Shelf B3", "With vendor"). Filled by the
   * linked-asset seam from the open custody episode, behind the asset read check. Never the free-text note.
   */
  custodyLocation?: string | null;
  /** Ticket work tag only: who acts next ("Waiting on vendor, Oct 29"). Derived from party + follow-up date only. */
  nextAction?: string | null;
  /**
   * Ticket work tag only: the full identification of the asset the tag is about, filled by the same
   * linked-asset seam behind the same asset read check. The 4 x 2 in tag ignores it; the full-page
   * customer worksheet prints it (Make/Model/CPU/RAM/Storage, OS-Ticket style). Null when the ticket
   * has no single readable affected asset for this label.
   */
  linkedAsset?: LabelLinkedAssetInfo | null;
  /**
   * Position of a staging box among its project's boxes ("Box n of m"), computed when the label is
   * rendered (a printed label is a snapshot). Null for every other label class.
   */
  sequence?: { n: number; total: number } | null;
  /**
   * RMA work tag only (C5). `identifier` is the RMA number, `title` the asset (or product) name, `detail` the
   * "vendor / reference" line, `secondaryIdentifier` + `serialSuffix` the asset tag and serial suffix.
   * Only what the tag needs on the bench: no reason text, no cost, no free-text notes.
   */
  rma?: {
    statusLabel: string | null;
    /** Calendar date (YYYY-MM-DD). */
    returnBy: string | null;
    /** "UPS 1Z999" style carrier + tracking of the latest leg, or null. */
    shipping: string | null;
    ticketNumber: string | null;
  } | null;
  /** Filled by the renderer, not by providers. */
  tenantClient?: LabelTenantClient | null;
  /** Filled by the renderer from the (already visibility-filtered) fields above: "Asset {tag}", "S/N ...{suffix}". */
  display?: { assetLine: string | null; serialLine: string | null; sequenceLine?: string | null; rmaReturnByLine?: string | null; rmaTicketLine?: string | null } | null;
}

export interface LabelRequestContext {
  tenant: string;
  user: IUserWithRoles;
  /** Absolute http(s) origin used to build `url` through `recordUrl`. */
  baseUrl: string;
  /** Set by the print composition root only when the resolved ticket template is a Letter worksheet. */
  includeWorksheetDetails?: boolean;
}

/**
 * Implemented by the package that owns a record type.
 *
 * Contract:
 *  - Returns one entry per requested id, in the SAME ORDER as `ids`.
 *  - An entry is null when the record does not exist in the tenant OR the caller may not read it.
 *    The two cases must be indistinguishable: an unauthorized request reveals nothing.
 *  - RBAC and record-level authorization are enforced here, before any data is returned.
 *  - Read-only. No writes, events or other side effects.
 */
export interface LabelViewModelProvider {
  readonly entityType: RecordEntityType;
  readonly labelClass: LabelClass;
  getLabelViewModels(
    context: LabelRequestContext,
    ids: readonly string[]
  ): Promise<Array<LabelViewModel | null>>;
}

/**
 * One record that cannot be printed with the requested template (e.g. an RMM-imported asset tag too
 * long for Code 128 at the minimum module width). Render failures are all-or-nothing: when any record
 * fails, nothing prints and the 422 response lists EVERY failing record, so the caller can drop them or
 * reprint them with `suggestedTemplateCode`. Only returned for records the caller was authorized to
 * read (authorization runs first; unreadable records are skipped and counted, never listed).
 */
export type LabelPrintErrorCode = 'worksheetPageSize' | 'worksheetTextOverflow';

export interface LabelPrintFailure {
  /** Zero-based position among the labels actually printed (after unreadable records were skipped). */
  index: number;
  recordId: string;
  identifier: string;
  templateCode: string;
  message: string;
  errorCode?: LabelPrintErrorCode;
  /** A standard template of the same label class that can print this record, when there is one. */
  suggestedTemplateCode?: string;
}

/** Largest batch one print request accepts. Batches are never split; the UIs disable above this. */
export const MAX_LABELS_PER_REQUEST = 200;
