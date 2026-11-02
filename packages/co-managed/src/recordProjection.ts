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
 *                Dependencies follow other declared fields and child paths (e.g. `quote_items.total_price`) transitively.
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

function recordFieldKey(source: RedactableRecordSource, alias: string): string | null {
  const table = source.resource.find(resource => alias.startsWith(`${resource}.`));
  return alias.startsWith('values.')
    ? alias.slice('values.'.length)
    : table
      ? alias.slice(table.length + 1)
      : alias.includes('.')
        ? null
        : alias;
}

/** Every spelling of a record field in its value and table namespaces. */
function recordFieldAliasForms(source: RedactableRecordSource, alias: string): readonly string[] {
  const field = recordFieldKey(source, alias);
  if (field === null) return [alias];
  return [alias, field, `values.${field}`, ...source.resource.map(resource => `${resource}.${field}`)];
}

/** Resolve the dependency graph once per field, sharing its aliases with serialization and predicate guards. */
export function recordFieldAliases(source: RedactableRecordSource, key: string): readonly string[] {
  const aliases = new Set<string>();
  const visited = new Map<RedactableRecordSource, Set<string>>();
  const visit = (recordSource: RedactableRecordSource, field: string): void => {
    const fields = visited.get(recordSource) ?? new Set<string>();
    if (fields.has(field)) return;
    fields.add(field);
    visited.set(recordSource, fields);
    recordFieldAliasForms(recordSource, field).forEach(alias => aliases.add(alias));

    const dependencies = [
      ...(Object.hasOwn(recordSource.fields, field) ? recordSource.fields[field] : []),
      ...(Object.hasOwn(recordSource.derived, field) ? recordSource.derived[field] : []),
    ];
    for (const dependency of dependencies) {
      aliases.add(dependency);
      const ownField = recordFieldKey(recordSource, dependency);
      if (ownField !== null) {
        visit(recordSource, ownField);
        continue;
      }
      const separator = dependency.indexOf('.');
      const childKey = dependency.slice(0, separator);
      const child = recordSource.children && Object.hasOwn(recordSource.children, childKey)
        ? recordSource.children[childKey]
        : undefined;
      if (child) {
        // A suppressed child cannot contribute to an aggregate, even when its numeric field itself is readable.
        // Do not add the resource root: that would make an unrelated sibling-field redaction hide the aggregate.
        child.identifier.flatMap(identifier => recordFieldAliasForms(child, identifier)).forEach(alias => aliases.add(alias));
        visit(child, dependency.slice(separator + 1));
      }
    }
  };
  visit(source, key);
  return [...aliases];
}

/** True when the row must not be served at all: the whole resource or an identifier is redacted. */
export function isRecordSuppressed(redactions: readonly string[], source: RedactableRecordSource): boolean {
  const identifierAliases = source.identifier.flatMap(identifier => recordFieldAliasForms(source, identifier));
  return isCoManagedResourceHidden(redactions, source.resource) || isCoManagedReadFieldHidden(redactions, identifierAliases);
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
const quoteItemSources = (...fields: string[]) => fields.flatMap(field => [field, `quote_items.${field}`]);

export const PROJECT_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PROJECT_FIELD_SOURCE, { title: 'project_name', description: 'description' }, {
    derived: {
      status_name: ids('status', 'statuses'),
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
    subcategory_name: ids('subcategory_id'),
    board_name: ids('board_id'),
    entered_by_name: ids('entered_by'),
    description_html: ids('attributes'),
    assigned_to_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    bundle_master_ticket_number: ids('master_ticket_id'),
    contact_avatar_url: ids('contact_name_id'),
    client_logo_url: ids('client_id'),
  },
};

export const QUOTE_LINE_RECORD_SOURCE: RedactableRecordSource = {
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'quote_items.quote_item_id'),
  fields: {},
  derived: {
    // Discount rows resolve against selected bases and their item/service targets before totals are persisted.
    total_price: ids('unit_price', 'quantity', 'discount_type', 'discount_percentage',
      'applies_to_item_id', 'applies_to_service_id', 'service_id', 'is_optional', 'is_selected', 'is_discount'),
    net_amount: ids('total_price', 'is_optional', 'is_selected', 'is_discount'),
    tax_amount: ids('total_price', 'tax_rate', 'is_taxable', 'tax_region', 'location_id', 'is_optional', 'is_selected', 'is_discount'),
  },
};

/** Quote-conversion preview lines preserve the quote-item source and its calculated price dependencies. */
export const QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE: RedactableRecordSource = {
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'quote_items.quote_item_id'),
  fields: {
    // Discount preview rows can rebuild unit_price from allocated quote discount amounts.
    unit_price: quoteItemSources(
      'unit_price', 'quantity', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
  },
  derived: {
    // Preview prices can be copied, discounted, or rebuilt from allocated quote discounts.
    total_price: quoteItemSources(
      'unit_price', 'quantity', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    location_name: ids('location_id', 'client_locations'),
    target: quoteItemSources('is_optional', 'is_selected', 'is_recurring', 'is_discount', 'service_id'),
    reason: quoteItemSources('description', 'service_name', 'service_id', 'is_optional', 'is_selected', 'is_recurring', 'is_discount'),
  },
};

/** A carried recurring discount is still derived from the quote item that funds it. */
export const QUOTE_CONVERSION_PREVIEW_DISCOUNT_SOURCE: RedactableRecordSource = {
  resource: ['quote_items'],
  identifier: ids('quote_item_id', 'line_quote_item_id', 'quote_items.quote_item_id'),
  fields: {},
  derived: {
    description: quoteItemSources('description', 'service_name'),
    line_description: quoteItemSources('description', 'service_name'),
    discount_type: quoteItemSources(
      'discount_type', 'discount_percentage', 'unit_price', 'quantity', 'is_optional', 'is_selected',
      'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    amount: quoteItemSources(
      'unit_price', 'quantity', 'discount_type', 'discount_percentage', 'is_optional', 'is_selected',
      'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
    percentage: quoteItemSources('discount_percentage', 'discount_type'),
    billing_frequency: quoteItemSources('billing_frequency'),
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
    // Stored header amounts are aggregates of quote lines; resolve their declared line dependencies even on lists
    // that do not load the items. This also carries line-price redactions through total_amount -> subtotal -> lines.
    subtotal: ids('quote_items.total_price'),
    discount_total: ids('quote_items.total_price'),
    tax: ids('quote_items.tax_amount'),
    total_amount: ids('subtotal', 'discount_total', 'tax'),
    optional_subtotal: ids('quote_items.total_price'),
    optional_tax: ids('quote_items.tax_amount'),
    optional_total: ids('optional_subtotal', 'optional_tax'),
    accepted_by_name: ids('accepted_by'),
    display_quote_number: ids('quote_number', 'version'),
  },
  children: { items: QUOTE_LINE_RECORD_SOURCE, quote_items: QUOTE_LINE_RECORD_SOURCE },
};

/** Nested quote-conversion response shape, projected under the quote's original authorization decision. */
export const QUOTE_CONVERSION_PREVIEW_SOURCE: RedactableRecordSource = {
  ...QUOTE_RECORD_SOURCE,
  derived: {
    ...QUOTE_RECORD_SOURCE.derived,
    available_actions: ids(
      ...quoteItemSources(
        'is_optional', 'is_selected', 'is_recurring', 'is_discount', 'service_id',
        'quantity', 'unit_price', 'discount_percentage', 'discount_type',
      ),
      'sales_orders',
    ),
    invoice_error: ids(
      ...quoteItemSources(
        'service_id', 'quantity', 'unit_price', 'discount_percentage', 'discount_type',
        'is_optional', 'is_selected', 'is_recurring', 'is_discount', 'applies_to_item_id', 'applies_to_service_id',
      ),
      'sales_orders.so_id', 'sales_orders.so_number',
    ),
    contract_blocked_reason: quoteItemSources(
      'description', 'service_id', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
    ),
    contract_blocked_item_description: ids('description', 'quote_items.description'),
    contract_monthly_before_discounts: quoteItemSources(
      'unit_price', 'quantity', 'billing_frequency', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
    ),
    contract_monthly_total: quoteItemSources(
      'unit_price', 'quantity', 'billing_frequency', 'is_optional', 'is_selected', 'is_recurring', 'is_discount',
      'discount_type', 'discount_percentage', 'applies_to_item_id', 'applies_to_service_id', 'service_id',
    ),
  },
  children: {
    ...QUOTE_RECORD_SOURCE.children,
    contract_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    invoice_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    sales_order_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    excluded_items: QUOTE_CONVERSION_PREVIEW_ITEM_SOURCE,
    contract_discounts: QUOTE_CONVERSION_PREVIEW_DISCOUNT_SOURCE,
    existing_sales_order: {
      resource: ['sales_orders'],
      identifier: ids('so_id', 'sales_orders.so_id'),
      fields: {},
      derived: {},
    },
  },
};

const ASSET_ROW_SOURCE: RedactableRecordSource = {
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

/** Flattened relationship rows copy fields from the other asset in the relationship. */
export const ASSET_RELATIONSHIP_SOURCE: RedactableRecordSource = {
  resource: ['assets'],
  identifier: ids('related_asset_id', 'asset_id', 'assets.asset_id'),
  fields: {
    related_asset_name: recordFieldAliases(ASSET_ROW_SOURCE, 'name'),
  },
  derived: {},
};

export const ASSET_MAINTENANCE_SCHEDULE_SOURCE: RedactableRecordSource = {
  resource: ['asset_maintenance_schedules'],
  identifier: ids('schedule_id', 'asset_maintenance_schedules.schedule_id'),
  fields: {},
  derived: {
    created_by_name: ids('created_by', 'users', 'users.first_name', 'users.last_name'),
  },
};

/** Assignment history rows include a joined contact label. */
export const ASSET_ASSIGNMENT_SOURCE: RedactableRecordSource = {
  resource: ['asset_assignments'],
  identifier: ids('assignment_id', 'asset_assignments.assignment_id'),
  fields: {},
  derived: {
    contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
  },
};

/** Maintenance history contains free-form maintenance data and a joined performer label. */
export const ASSET_MAINTENANCE_HISTORY_SOURCE: RedactableRecordSource = {
  resource: ['asset_maintenance_history'],
  identifier: ids('history_id', 'asset_maintenance_history.history_id'),
  fields: {},
  derived: {
    performed_by_user_name: ids('performed_by', 'users', 'users.first_name', 'users.last_name'),
  },
};

export const ASSET_RECORD_SOURCE: RedactableRecordSource = {
  ...ASSET_ROW_SOURCE,
  children: {
    client: {
      resource: ['clients'],
      // The nested client is loaded through the asset's foreign key and copies its joined label. Compose the
      // parent aliases so hiding either representation also hides the same data inside the child record.
      identifier: [...ids('client_id', 'clients.client_id'), ...recordFieldAliases(ASSET_ROW_SOURCE, 'client_id')],
      fields: { client_name: recordFieldAliases(ASSET_ROW_SOURCE, 'client_name') },
      derived: {},
    },
    maintenance_schedules: {
      ...ASSET_MAINTENANCE_SCHEDULE_SOURCE,
    },
    relationships: ASSET_RELATIONSHIP_SOURCE,
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
