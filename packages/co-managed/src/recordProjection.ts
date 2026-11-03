import {
  CO_MANAGED_ASSIGNEE_NAME_ALIASES,
  CO_MANAGED_PHASE_FIELD_SOURCE,
  CO_MANAGED_PROJECT_FIELD_SOURCE,
  CO_MANAGED_TASK_FIELD_SOURCE,
  type CoManagedFieldSource,
} from './sharedWorkProjection';
import {
  ASSET_RECORD_SOURCE,
  createRecordProjectionPolicy,
  recordFieldAliases,
  type RedactableRecordSource,
  type RecordFieldReference,
} from '@alga-psa/authorization/recordProjection';
export * from '@alga-psa/authorization/recordProjection';

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

const ids = (...names: string[]) => names;
const quoteItemSources = (...fields: string[]) => fields.flatMap(field => [field, `quote_items.${field}`]);


export const PROJECT_TASK_CHECKLIST_ITEM_SOURCE: RedactableRecordSource = {
  resource: ['task_checklist_items'],
  identifier: ids('checklist_item_id', 'task_checklist_items.checklist_item_id'),
  fields: {},
  derived: {},
};

/** Project phases use the shared canonical source aliases for description and parent/project identifiers. */
export const PROJECT_PHASE_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PHASE_FIELD_SOURCE, { title: 'phase_name', description: 'description' }, { derived: {} },
);

export const PROJECT_STATUS_MAPPING_SOURCE: RedactableRecordSource = {
  resource: ['project_status_mappings'],
  identifier: ids('project_status_mapping_id', 'project_status_mappings.project_status_mapping_id'),
  fields: {},
  derived: {
    status_name: ids('custom_name', 'status_id', 'statuses', 'statuses.name', 'standard_status_id', 'standard_statuses', 'standard_statuses.name'),
    name: ids('custom_name', 'status_id', 'statuses', 'statuses.name', 'standard_status_id', 'standard_statuses', 'standard_statuses.name'),
    is_closed: ids('status_id', 'statuses', 'standard_status_id', 'standard_statuses'),
  },
};

const PROJECT_TASK_SERVICE_DEPENDENCIES: readonly (string | RecordFieldReference)[] = [
  'service_id', 'phase_id', 'project_id', 'projects.service_id',
  { source: PROJECT_PHASE_RECORD_SOURCE, field: 'service_id' },
];

/** Project task responses retain task column and relationship aliases across project-scoped endpoints. */
export const PROJECT_TASK_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_TASK_FIELD_SOURCE, { title: 'task_name', description: 'description' }, {
    derived: {
      assigned_user_name: ids('assigned_to', 'users', 'users.first_name', 'users.last_name'),
      status_name: ['project_status_mapping_id', { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'status_name' }],
      is_closed: ['project_status_mapping_id', { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'is_closed' }],
      phase_name: ['phase_id', { source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_name' }],
      project_name: ids('project_id', 'projects', 'projects.project_name'),
      client_id: ids('project_id', 'projects.client_id'),
      effective_service_id: PROJECT_TASK_SERVICE_DEPENDENCIES,
      service_source: PROJECT_TASK_SERVICE_DEPENDENCIES,
      service_name: [...PROJECT_TASK_SERVICE_DEPENDENCIES, 'service_catalog', 'service_catalog.service_name'],
    },
    children: { checklist_items: PROJECT_TASK_CHECKLIST_ITEM_SOURCE },
  });

export const PROJECT_RECORD_SOURCE: RedactableRecordSource = recordSourceFromCoManaged(
  CO_MANAGED_PROJECT_FIELD_SOURCE, { title: 'project_name', description: 'description' }, {
    derived: {
      status_name: ids('status', 'statuses'),
      client_name: ids('client_id', 'clients', 'clients.client_id', 'clients.client_name'),
      contact_name: ids('contact_name_id', 'contacts', 'contacts.full_name'),
      assigned_user_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to'],
    },
    children: {
      tasks: PROJECT_TASK_RECORD_SOURCE,
      phases: PROJECT_PHASE_RECORD_SOURCE,
      status_mappings: PROJECT_STATUS_MAPPING_SOURCE,
    },
  });

/**
 * The ticket-side link endpoint returns a flattened row assembled from project,
 * phase, task and task-status records. Keep those copied values attached to
 * their owning descriptors so the retained project policy can redact or
 * suppress each source independently.
 */
export const TICKET_PROJECT_LINK_SOURCE: RedactableRecordSource = {
  policySource: PROJECT_RECORD_SOURCE,
  resource: ['project_ticket_links'],
  identifier: ids('link_id', 'project_ticket_links.link_id'),
  fields: {},
  derived: {
    project_id: [{ source: PROJECT_RECORD_SOURCE, field: 'project_id' }],
    project_name: ['project_id', { source: PROJECT_RECORD_SOURCE, field: 'project_name' }],
    project_number: ['project_id', { source: PROJECT_RECORD_SOURCE, field: 'project_number' }],
    phase_id: [{ source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_id' }],
    phase_name: ['phase_id', { source: PROJECT_PHASE_RECORD_SOURCE, field: 'phase_name' }],
    task_id: [{ source: PROJECT_TASK_RECORD_SOURCE, field: 'task_id' }],
    task_name: ['task_id', { source: PROJECT_TASK_RECORD_SOURCE, field: 'task_name' }],
    project_status_mapping_id: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'project_status_mapping_id' },
    ],
    status_name: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'status_name' },
    ],
    is_closed: [
      'task_id',
      { source: PROJECT_TASK_RECORD_SOURCE, field: 'project_status_mapping_id' },
      { source: PROJECT_STATUS_MAPPING_SOURCE, field: 'is_closed' },
    ],
    task_updated_at: ['task_id', { source: PROJECT_TASK_RECORD_SOURCE, field: 'updated_at' }],
  },
};

export const TICKET_DOCUMENT_SOURCE: RedactableRecordSource = {
  resource: ['documents', 'document_associations'],
  identifier: ids(
    'document_id', 'documents.document_id',
    'document_associations.document_id', 'association_id', 'document_associations.association_id',
  ),
  fields: {},
  derived: {
    created_by_full_name: ids('created_by', 'users', 'users.first_name', 'users.last_name'),
    association_created_at: ids('document_associations.created_at'),
    type_name: ids(
      'type_id', 'documents.type_id', 'document_types', 'document_types.type_id', 'document_types.type_name',
      'shared_type_id', 'documents.shared_type_id', 'shared_document_types', 'shared_document_types.type_id',
      'shared_document_types.type_name',
    ),
    type_icon: ids(
      'type_id', 'documents.type_id', 'document_types', 'document_types.type_id', 'document_types.icon',
      'shared_type_id', 'documents.shared_type_id', 'shared_document_types', 'shared_document_types.type_id',
      'shared_document_types.icon',
    ),
  },
};

/** Storage metadata is another representation of the document, including the storage fallback fields. */
export const TICKET_DOCUMENT_DOWNLOAD_SOURCE: RedactableRecordSource = {
  policySource: TICKET_DOCUMENT_SOURCE,
  resource: [...TICKET_DOCUMENT_SOURCE.resource, 'external_files'],
  identifier: TICKET_DOCUMENT_SOURCE.identifier,
  fields: {
    fileName: ids('document_name', 'file_id', 'external_files.file_id', 'external_files.original_name'),
    mimeType: ids('mime_type', 'file_id', 'external_files.file_id', 'external_files.mime_type'),
  },
  derived: {},
};

function ticketDocumentVariantSource(fileIdField: string): RedactableRecordSource {
  return {
    ...TICKET_DOCUMENT_DOWNLOAD_SOURCE,
    fields: {
      fileId: ids(fileIdField, 'file_id', 'external_files.file_id'),
      mimeType: ids('mime_type', 'fileId', 'external_files.mime_type'),
    },
  };
}

export const TICKET_DOCUMENT_VARIANT_SOURCES = {
  thumbnail: ticketDocumentVariantSource('thumbnail_file_id'),
  preview: ticketDocumentVariantSource('preview_file_id'),
} as const;

/** Detached ticket comments retain the comment row's source, including rendered text derived from `note`. */
export const TICKET_COMMENT_SOURCE: RedactableRecordSource = {
  resource: ['comments'],
  identifier: ids('comment_id', 'comments.comment_id'),
  fields: {
    user_id: ids('created_by'),
    contact_id: ids('author_contact_id'),
  },
  derived: {
    comment_text: ids('note', 'comments.note'),
    comment_html: ids('note', 'comments.note'),
    markdown_content: ids('note', 'comments.note'),
    created_by: ids('user_id', 'users.user_id'),
    created_by_name: ids('user_id', 'users', 'users.first_name', 'users.last_name', 'users.email', 'contact_id', 'contacts', 'metadata'),
    created_by_avatar_url: ids('user_id', 'users'),
    author_contact_id: ids('contact_id', 'contacts.contact_name_id'),
    author_contact_name: ids('author_contact_id', 'contacts', 'contacts.full_name'),
    author_contact_email: ids('author_contact_id', 'contacts', 'contacts.email'),
    reactions: ids('comment_id', 'comment_reactions'),
    reaction_user_names: ids('comment_id', 'comment_reactions', 'users'),
    email_recipients: ids('metadata'),
  },
};

/** Detached material rows keep their table aliases and the joined service name dependency. */
export const TICKET_MATERIAL_SOURCE: RedactableRecordSource = {
  resource: ['ticket_materials'],
  identifier: ids('ticket_material_id', 'ticket_materials.ticket_material_id', 'values.ticket_materials.ticket_material_id'),
  fields: {},
  derived: {
    service_name: ids('service_id', 'service_catalog', 'service_catalog.service_name'),
    sku: ids('service_id', 'service_catalog', 'service_catalog.sku'),
  },
};

export const TICKET_CHECKLIST_ITEM_SOURCE: RedactableRecordSource = {
  resource: ['ticket_checklist_items'],
  identifier: ids('checklist_item_id', 'ticket_checklist_items.checklist_item_id', 'values.ticket_checklist_items.checklist_item_id'),
  fields: {},
  derived: {
    completed_by_name: ids('completed_by', 'users', 'users.first_name', 'users.last_name', 'users.username'),
  },
};

export const TICKET_EXTERNAL_LINK_SOURCE: RedactableRecordSource = {
  resource: ['external_entity_links'],
  identifier: ids('link_id', 'external_entity_links.link_id', 'values.external_entity_links.link_id'),
  fields: {},
  derived: {
    // These values are rendered from the external system definition and link identifiers, not independent fields.
    url: ids('system', 'external_id', 'external_parent_id', 'realm', 'tenant_external_systems'),
    display: ids('system', 'external_id', 'external_parent_id', 'realm', 'tenant_external_systems'),
    actor: ids('actor_id', 'users'),
  },
};

export const TICKET_WATCHER_SOURCE: RedactableRecordSource = {
  resource: ['ticket_watchers'],
  identifier: ids('entity_id', 'ticket_watchers.entity_id'),
  fields: {},
  derived: {
    name: ids('entity_type', 'entity_id', 'users', 'users.first_name', 'users.last_name', 'contacts', 'contacts.full_name'),
  },
};

export const TICKET_TIME_ENTRY_SOURCE: RedactableRecordSource = {
  resource: ['time_entries'],
  identifier: ids('entry_id', 'time_entries.entry_id'),
  fields: {},
  derived: {
    is_own: ids('user_id'),
    user_name: ids('user_id', 'users', 'users.first_name', 'users.last_name'),
    service_name: ids('service_id', 'service_catalog', 'service_catalog.service_name'),
  },
};

/** The stored watch list is a mirror of the same watcher records returned by the detached endpoint. */
const TICKET_ATTRIBUTES_SOURCE: RedactableRecordSource = {
  resource: ['tickets.attributes'],
  identifier: [],
  fields: {},
  derived: {},
  children: { watch_list: TICKET_WATCHER_SOURCE },
};

const TICKET_PRIMARY_AGENT_SOURCE: RedactableRecordSource = {
  resource: ['users'],
  // The primary agent object exists only because tickets.assigned_to exists. Hiding that source suppresses the
  // representation as a whole, including its copied user_id.
  identifier: ids('user_id', 'assigned_to', 'tickets.assigned_to', 'values.assigned_to', 'fields.tickets.assigned_to'),
  fields: {},
  derived: {
    first_name: ids('tickets.assigned_to', 'users.first_name'),
    last_name: ids('tickets.assigned_to', 'users.last_name'),
    email: ids('tickets.assigned_to', 'users.email'),
  },
};

const TICKET_ADDITIONAL_AGENT_SOURCE: RedactableRecordSource = {
  resource: ['ticket_resources'],
  identifier: ids('assignment_id', 'ticket_resources.assignment_id', 'additional_user_id', 'ticket_resources.additional_user_id', 'user_id', 'users.user_id'),
  fields: {},
  derived: {
    first_name: ids('additional_user_id', 'users.first_name'),
    last_name: ids('additional_user_id', 'users.last_name'),
    email: ids('additional_user_id', 'users.email'),
  },
};

/** Agent service response is an alternate ticket representation, projected under the ticket's original decision. */
export const TICKET_AGENT_RESPONSE_SOURCE: RedactableRecordSource = {
  resource: ['tickets'],
  identifier: ids('ticket_id', 'tickets.ticket_id'),
  fields: {},
  derived: {},
  children: {
    primary_agent: TICKET_PRIMARY_AGENT_SOURCE,
    additional_agents: TICKET_ADDITIONAL_AGENT_SOURCE,
  },
};

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
    assigned_to_name: [...CO_MANAGED_ASSIGNEE_NAME_ALIASES, 'assigned_to', 'users.first_name', 'users.last_name'],
    bundle_master_ticket_number: ids('master_ticket_id'),
    contact_avatar_url: ids('contact_name_id'),
    client_logo_url: ids('client_id'),
  },
  children: {
    attributes: TICKET_ATTRIBUTES_SOURCE,
    documents: TICKET_DOCUMENT_SOURCE,
    comments: TICKET_COMMENT_SOURCE,
    materials: TICKET_MATERIAL_SOURCE,
    checklist: TICKET_CHECKLIST_ITEM_SOURCE,
    external_links: TICKET_EXTERNAL_LINK_SOURCE,
    watchers: TICKET_WATCHER_SOURCE,
    time_entries: TICKET_TIME_ENTRY_SOURCE,
    // The service names its response keys `additional_agents` / `primary_agent`; these nested sources are also
    // used by the detached agents endpoint below.
    primary_agent: TICKET_PRIMARY_AGENT_SOURCE,
    additional_agents: TICKET_ADDITIONAL_AGENT_SOURCE,
  },
};

/** ProjectService.getProjectTickets returns ticket fields joined with assignee and link metadata. */
export const PROJECT_TICKET_RESPONSE_SOURCE: RedactableRecordSource = {
  ...TICKET_RECORD_SOURCE,
  policySource: TICKET_RECORD_SOURCE,
  resource: [...TICKET_RECORD_SOURCE.resource, 'project_ticket_links'],
  identifier: [...TICKET_RECORD_SOURCE.identifier, 'link_id', 'project_ticket_links.link_id'],
  derived: {
    ...TICKET_RECORD_SOURCE.derived,
    assigned_user_name: [{ source: TICKET_RECORD_SOURCE, field: 'assigned_to_name' }],
    link_created_at: ids('project_ticket_links.created_at'),
  },
};

const TICKET_TIME_ENTRY_COUNT_DEPENDENCIES = ids(
  'entries.entry_id', 'entries.user_id',
);
const TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES = ids(
  ...TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
  'entries.start_time', 'entries.end_time', 'entries.billable_duration',
);

/** Ticket time-entry summaries are calculated from their visible entry set. */
export const TICKET_TIME_ENTRIES_RESPONSE_SOURCE: RedactableRecordSource = {
  policySource: TICKET_RECORD_SOURCE,
  resource: [],
  identifier: [],
  fields: {},
  derived: {
    ownTotalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    ownEntryCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersTotalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersEntryCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersVisibleMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersVisibleCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    othersHiddenMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
    othersHiddenCount: TICKET_TIME_ENTRY_COUNT_DEPENDENCIES,
    totalMinutes: TICKET_TIME_ENTRY_MINUTE_DEPENDENCIES,
  },
  children: { entries: TICKET_TIME_ENTRY_SOURCE },
};

/** An external-link lookup is another ticket representation with one detached link. */
export const TICKET_EXTERNAL_LINK_LOOKUP_SOURCE: RedactableRecordSource = {
  ...TICKET_RECORD_SOURCE,
  policySource: TICKET_RECORD_SOURCE,
  children: { link: TICKET_EXTERNAL_LINK_SOURCE },
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
  policySource: QUOTE_LINE_RECORD_SOURCE,
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
  policySource: QUOTE_LINE_RECORD_SOURCE,
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

const QUOTE_ACTIVITY_METADATA_SOURCE: RedactableRecordSource = {
  resource: [],
  identifier: [],
  fields: { comment: [] },
  derived: {},
};

/** Quote audit rows keep the activity table namespace; approval comments are copied into both metadata and description. */
export const QUOTE_ACTIVITY_SOURCE: RedactableRecordSource = {
  resource: ['quote_activities'],
  identifier: ids('activity_id', 'quote_activities.activity_id'),
  fields: {},
  derived: {
    metadata: ids('description', 'quote_activities.description'),
    description: ids('metadata', 'metadata.comment', 'quote_activities.metadata.comment'),
  },
  children: { metadata: QUOTE_ACTIVITY_METADATA_SOURCE },
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
  children: {
    items: QUOTE_LINE_RECORD_SOURCE,
    quote_items: QUOTE_LINE_RECORD_SOURCE,
    activities: QUOTE_ACTIVITY_SOURCE,
  },
};

/** Nested quote-conversion response shape, projected under the quote's original authorization decision. */
export const QUOTE_CONVERSION_PREVIEW_SOURCE: RedactableRecordSource = {
  ...QUOTE_RECORD_SOURCE,
  policySource: QUOTE_RECORD_SOURCE,
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

/** The shared asset-ticket edge owns the copied association metadata and both foreign identifiers. */
export const ASSET_TICKET_ASSOCIATION_SOURCE: RedactableRecordSource = {
  resource: ['asset_associations'],
  identifier: ids(
    'association_id', 'asset_associations.association_id',
    'asset_id', 'assets.asset_id', 'asset_associations.asset_id',
    'entity_id', 'tickets.ticket_id', 'asset_associations.entity_id',
    'entity_type', 'asset_associations.entity_type',
  ),
  fields: {
    relationship_type: ids('relationship_type', 'asset_associations.relationship_type'),
    association_notes: ids('notes', 'asset_associations.notes'),
    linked_at: ids('created_at', 'asset_associations.created_at'),
  },
  derived: {},
};

/** Asset-to-ticket rows retain the canonical ticket descriptor and add association-owned aliases. */
export const ASSET_TICKETS_RESPONSE_SOURCE: RedactableRecordSource = {
  ...TICKET_RECORD_SOURCE,
  policySource: TICKET_RECORD_SOURCE,
  resource: [...TICKET_RECORD_SOURCE.resource, ...ASSET_TICKET_ASSOCIATION_SOURCE.resource],
  identifier: [...TICKET_RECORD_SOURCE.identifier, ...ASSET_TICKET_ASSOCIATION_SOURCE.identifier],
  fields: { ...TICKET_RECORD_SOURCE.fields, ...ASSET_TICKET_ASSOCIATION_SOURCE.fields },
  derived: { ...TICKET_RECORD_SOURCE.derived, ...ASSET_TICKET_ASSOCIATION_SOURCE.derived },
};

const ASSET_SUMMARY_TICKET_STATUS_SOURCE: RedactableRecordSource = {
  resource: ['statuses'],
  identifier: ['status_id', 'statuses.status_id'],
  fields: {},
  derived: {},
};

/** The open-ticket aggregate uses the joined status, independently of other status labels. */
export const ASSET_SUMMARY_TICKET_SOURCE: RedactableRecordSource = {
  ...ASSET_TICKETS_RESPONSE_SOURCE,
  derived: {
    ...ASSET_TICKETS_RESPONSE_SOURCE.derived,
    status_is_closed: ['status_id', { source: ASSET_SUMMARY_TICKET_STATUS_SOURCE, field: 'is_closed' }],
  },
};

/** Ticket-to-asset rows retain the canonical asset descriptor and add association-owned aliases. */
export const TICKET_ASSETS_RESPONSE_SOURCE: RedactableRecordSource = {
  ...ASSET_RECORD_SOURCE,
  policySource: ASSET_RECORD_SOURCE,
  resource: [...ASSET_RECORD_SOURCE.resource, ...ASSET_TICKET_ASSOCIATION_SOURCE.resource],
  identifier: [...ASSET_RECORD_SOURCE.identifier, ...ASSET_TICKET_ASSOCIATION_SOURCE.identifier],
  fields: { ...ASSET_RECORD_SOURCE.fields, ...ASSET_TICKET_ASSOCIATION_SOURCE.fields },
  derived: { ...ASSET_RECORD_SOURCE.derived, ...ASSET_TICKET_ASSOCIATION_SOURCE.derived },
};

/** Installed software rows retain the canonical asset policy and the joined catalog source. */
export const ASSET_SOFTWARE_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: ['asset_software', 'software_catalog'],
  identifier: ids(
    'software_id', 'asset_software.software_id', 'software_catalog.software_id',
    'asset_id', 'asset_software.asset_id',
  ),
  fields: {
    name: ids('software_name', 'software_catalog.name'),
    publisher: ids('publisher', 'software_catalog.publisher'),
    category: ids('category', 'software_catalog.category'),
    software_type: ids('software_type', 'software_catalog.software_type'),
    version: ids('version', 'asset_software.version'),
    install_date: ids('install_date', 'asset_software.install_date'),
    size_bytes: ids('size_bytes', 'asset_software.size_bytes'),
    first_seen_at: ids('first_seen_at', 'asset_software.first_seen_at'),
    is_current: ids('is_current', 'asset_software.is_current'),
    is_managed: ids('software_catalog.is_managed'),
    is_security_relevant: ids('software_catalog.is_security_relevant'),
  },
  derived: {},
};

/** Summary values are calculated from authorized software rows before this response projection. */
export const ASSET_SOFTWARE_SUMMARY_SOURCE: RedactableRecordSource = {
  policySource: ASSET_RECORD_SOURCE,
  resource: [],
  identifier: [],
  fields: {},
  derived: {},
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
  return createRecordProjectionPolicy(redactions, source).readable(field, source);
}
