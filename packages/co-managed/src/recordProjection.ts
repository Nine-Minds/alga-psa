import {
  CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  CO_MANAGED_PROJECT_FIELD_SOURCE,
  isCoManagedResourceHidden,
  type CoManagedFieldSource,
} from './sharedWorkProjection';
import { isCoManagedReadFieldHidden } from './sharedWorkRedaction';

/**
 * Declarative description of one record kind for policy redaction. Same shape as `CoManagedFieldSource`
 * (resource / identifier) plus the per-field alias tables a generic projector needs:
 *
 * - `resource`   aliases naming the whole resource (also the `table.` prefixes of its columns). Hidden => row suppressed.
 * - `identifier` aliases naming the identifier(s) that locate the row. Hidden => row suppressed.
 * - `fields`     EXTRA aliases for a field beyond the implicit `[name, values.name, <table>.name]`. Hidden => field omitted.
 * - `derived`    display values built from another source (assignee name, client name, computed totals): field => source aliases.
 *                Hidden source (or hidden field) => field set to null, never dropped.
 * - `children`   nested arrays/objects (e.g. quote lines) projected with their own source; suppressed children are dropped.
 */
export interface RedactableRecordSource {
  readonly resource: readonly string[];
  readonly identifier: readonly string[];
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly derived: Readonly<Record<string, readonly string[]>>;
  readonly children?: Readonly<Record<string, RedactableRecordSource>>;
}

/** Builds a descriptor from an existing co-managed source, mapping its title/description onto the row's column names. */
export function recordSourceFromCoManaged(
  source: CoManagedFieldSource,
  columns: { title?: string; description?: string },
  rest: Pick<RedactableRecordSource, 'derived'> & Partial<Pick<RedactableRecordSource, 'fields' | 'children'>>,
): RedactableRecordSource {
  // Resource and identifier aliases (`projects`, `project_id`, ...) hide the WHOLE row here (suppression). Left in a
  // field's list they would also match every sibling path (`projects.description` => `projects`), so a field-level
  // redaction would wrongly take the title with it.
  const wholeRow = new Set([...source.resource, ...source.identifier]);
  const fieldOnly = (aliases: readonly string[]) => aliases.filter(alias => !wholeRow.has(alias));
  return {
    resource: source.resource,
    identifier: source.identifier,
    fields: {
      ...(columns.title ? { [columns.title]: fieldOnly(source.title) } : {}),
      ...(columns.description ? { [columns.description]: fieldOnly(source.description) } : {}),
      ...rest.fields,
    },
    derived: rest.derived,
    children: rest.children,
  };
}

/** Every alias a record key is matched against: itself, `values.`/`<table>.` forms, declared extras, and derived sources. */
export function recordFieldAliases(source: RedactableRecordSource, key: string): readonly string[] {
  return [
    key, `values.${key}`, ...source.resource.map(table => `${table}.${key}`),
    ...(Object.hasOwn(source.fields, key) ? source.fields[key] : []),
    ...(Object.hasOwn(source.derived, key) ? source.derived[key] : []),
  ];
}

/** True when the row must not be served at all: the whole resource or an identifier is redacted. */
export function isRecordSuppressed(redactions: readonly string[], source: RedactableRecordSource): boolean {
  return isCoManagedResourceHidden(redactions, source.resource) || isCoManagedReadFieldHidden(redactions, source.identifier);
}

/**
 * Applies a reader's redactions to one record. Returns null when the row is suppressed; otherwise a copy with hidden
 * fields omitted and hidden derived fields nulled. A field-level redaction such as `projects.description` never suppresses.
 */
export function projectRecordByRedactions<T extends Record<string, any>>(
  redactions: readonly string[], record: T, source: RedactableRecordSource): Partial<T> | null {
  if (isRecordSuppressed(redactions, source)) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (isCoManagedReadFieldHidden(redactions, recordFieldAliases(source, key))) {
      if (Object.hasOwn(source.derived, key)) out[key] = null;
      continue;
    }
    const child = source.children && Object.hasOwn(source.children, key) ? source.children[key] : undefined;
    if (child && Array.isArray(value)) {
      out[key] = value.map(item => (item && typeof item === 'object' ? projectRecordByRedactions(redactions, item, child) : item)).filter(item => item !== null);
    } else if (child && value && typeof value === 'object') {
      out[key] = projectRecordByRedactions(redactions, value as Record<string, any>, child);
    } else {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

const ids = (...names: string[]) => names;

export const PROJECT_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PROJECT_FIELD_SOURCE, { title: 'project_name', description: 'description' }, {
    derived: {
      client_name: ids('client_id', 'clients', 'clients.client_name'),
      contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
      assigned_user_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    },
  });

export const TICKET_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['tickets'],
  identifier: ids('ticket_id', 'tickets.ticket_id', 'ticket', 'ticketId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    client_email: ids('client_id', 'location_id', 'client_locations'),
    client_phone: ids('client_id', 'location_id', 'client_locations'),
    location_name: ids('location_id', 'client_locations'),
    location_address: ids('location_id', 'client_locations'),
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
    contact_email: ids('contact_name_id', 'contacts'),
    contact_phone: ids('contact_name_id', 'contacts'),
    status_name: ids('status_id', 'statuses'),
    status_is_closed: ids('status_id', 'statuses'),
    priority_name: ids('priority_id', 'priorities'),
    category_name: ids('category_id', 'subcategory_id', 'categories'),
    assigned_to_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    bundle_master_ticket_number: ids('master_ticket_id'),
  },
};

export const QUOTE_LINE_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'quote_items.quote_item_id'),
  fields: {},
  derived: {
    total_price: ids('unit_price', 'quantity'),
    net_amount: ids('unit_price', 'quantity'),
    tax_amount: ids('unit_price', 'quantity', 'tax_rate'),
  },
};

/** Quotes are read under the kernel's `billing` resource, so a whole-`billing` redaction hides the quote too. */
export const QUOTE_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['quotes', 'billing'],
  identifier: ids('quote_id', 'quotes.quote_id', 'quote', 'quoteId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    contact_name: ids('contact_id', 'contacts'),
    total_amount: ids('subtotal', 'discount_total', 'tax'),
    accepted_by_name: ids('accepted_by'),
  },
  children: { items: QUOTE_LINE_RECORD_SOURCE, quote_items: QUOTE_LINE_RECORD_SOURCE },
};

export const ASSET_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['assets'],
  identifier: ids('asset_id', 'assets.asset_id', 'asset', 'assetId'),
  fields: {},
  derived: {
    client_name: ids('client_id', 'clients', 'clients.client_name'),
    vendor_name: ids('vendor_id', 'vendors'),
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
    warranty_status: ids('warranty_end_date'),
  },
};

/**
 * Predicate-side counterpart of `projectRecordByRedactions`: true when `field` (a response key such as `description`
 * or the derived `client_name`) may take part in a search or filter for a reader with `redactions`. It resolves
 * through the very same aliases the projector uses (`recordFieldAliases`), so canonical aliases and derived fields
 * that depend on a hidden source are excluded exactly when the projector would omit or null them.
 *
 * Fails closed: a suppressed record kind, or any redaction entry that cannot be interpreted, makes the field
 * unreadable. Without this, `?search=` over a hidden column returns the row and confirms the substring exists.
 */
export function isRecordFieldReadable(
  redactions: readonly string[], source: RedactableRecordSource, field: string): boolean {
  try {
    if (isRecordSuppressed(redactions, source)) return false;
    return !isCoManagedReadFieldHidden(redactions, recordFieldAliases(source, field));
  } catch {
    return false;
  }
}
