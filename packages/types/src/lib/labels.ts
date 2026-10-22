import type { IUserWithRoles } from '../interfaces/auth.interfaces';
import type { RecordEntityType } from './recordLinks';

/**
 * Label contracts shared by the label renderer (billing) and the record owners
 * (tickets, assets, inventory). Billing never imports those packages and they never import
 * billing: each owner implements `LabelViewModelProvider` and the server route (the composition
 * root) wires providers to the renderer.
 */

/** Which standard label layout a record is printed with. */
export const LABEL_CLASSES = ['ticket-work-tag', 'asset-identity', 'stock-unit-identity'] as const;
export type LabelClass = (typeof LABEL_CLASSES)[number];

export function isLabelClass(value: unknown): value is LabelClass {
  return typeof value === 'string' && (LABEL_CLASSES as readonly string[]).includes(value);
}

/** The record type each label class prints. */
export const LABEL_CLASS_ENTITY_TYPE: Record<LabelClass, RecordEntityType> = {
  'ticket-work-tag': 'ticket',
  'asset-identity': 'asset',
  'stock-unit-identity': 'stock_unit',
};

/**
 * One uniform shape for every label class (decision: one generic `work-tag` document type).
 * Fields a class has no use for are null. Defaults deliberately exclude sensitive data: no
 * comments, credentials or full serial numbers (only `serialSuffix`).
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
  /** Filled by the renderer, not by providers. */
  tenantClient?: { name: string | null; logoUrl: string | null } | null;
}

export interface LabelRequestContext {
  tenant: string;
  user: IUserWithRoles;
  /** Absolute http(s) origin used to build `url` through `recordUrl`. */
  baseUrl: string;
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
 * long for Code 128 at the minimum module width). Batches are all-or-nothing: when any record fails,
 * nothing prints and the 422 response lists EVERY failing record, so the caller can drop them or
 * reprint them with `suggestedTemplateCode`. Only returned for records the caller was authorized to
 * read (authorization runs first and fails the whole request as not found).
 */
export interface LabelPrintFailure {
  /** Zero-based position in the request's `ids`. */
  index: number;
  recordId: string;
  identifier: string;
  templateCode: string;
  message: string;
  /** A standard template of the same label class that can print this record, when there is one. */
  suggestedTemplateCode?: string;
}
