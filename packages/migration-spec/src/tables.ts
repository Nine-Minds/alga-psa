/**
 * AMP v1 table allowlist.
 *
 * A conforming package contains only these tables. The manifest table holds
 * exactly one row; entity tables hold canonical records; auxiliary tables hold
 * namespaced identifiers, preserved custom fields, and producer diagnostics.
 */

export const AMP_ENTITY_TABLES = [
  'organizations',
  'locations',
  'contacts',
  'tickets',
  'ticket_comments',
  'assets',
  'products',
  'vendor_products',
] as const;

export const AMP_AUXILIARY_TABLES = [
  'external_identifiers',
  'custom_field_values',
  'package_diagnostics',
] as const;

export const AMP_MANIFEST_TABLE = 'amp_manifest' as const;

export const AMP_ALLOWLISTED_TABLES = [
  AMP_MANIFEST_TABLE,
  ...AMP_ENTITY_TABLES,
  ...AMP_AUXILIARY_TABLES,
] as const;

export type AmpEntityType = (typeof AMP_ENTITY_TABLES)[number];
export type AmpAuxiliaryTable = (typeof AMP_AUXILIARY_TABLES)[number];
export type AmpTable = (typeof AMP_ALLOWLISTED_TABLES)[number];

/** Columns shared by every canonical entity table. */
export const AMP_ENTITY_IDENTITY_COLUMNS = [
  'package_record_id',
  'source_record_id',
  'external_identifier_namespace',
  'created_at',
  'updated_at',
  'extension_json',
] as const;

/**
 * Exact column set per allowlisted table. Validators reject packages whose
 * tables carry any other column, and treat a missing column as a schema error.
 */
export const AMP_TABLE_COLUMNS: Record<AmpTable, readonly string[]> = {
  amp_manifest: [
    'format_version',
    'package_id',
    'created_at',
    'producer_name',
    'producer_version',
    'source_system',
    'source_instance_id',
    'export_started_at',
    'export_completed_at',
    'content_sha256',
    'capabilities_json',
  ],
  organizations: [...AMP_ENTITY_IDENTITY_COLUMNS, 'name', 'website', 'phone'],
  locations: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'organization_package_record_id',
    'name',
    'address_line1',
    'address_line2',
    'city',
    'region',
    'postal_code',
    'country_code',
    'phone',
  ],
  contacts: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'organization_package_record_id',
    'location_package_record_id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'title',
  ],
  tickets: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'organization_package_record_id',
    'location_package_record_id',
    'requester_package_record_id',
    'title',
    'description',
    'status_name',
    'priority_name',
    'category_name',
    'closed_at',
  ],
  ticket_comments: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'ticket_package_record_id',
    'author_package_record_id',
    'body',
    'is_internal',
  ],
  assets: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'organization_package_record_id',
    'location_package_record_id',
    'name',
    'asset_type_name',
    'serial_number',
    'manufacturer',
    'model',
    'purchase_date',
  ],
  products: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'name',
    'sku',
    'category_name',
    'unit_of_measure',
    'price_minor',
    'price_currency',
    'cost_minor',
    'cost_currency',
    'description',
    'is_active',
  ],
  vendor_products: [
    ...AMP_ENTITY_IDENTITY_COLUMNS,
    'product_package_record_id',
    'product_sku',
    'vendor_name',
    'vendor_sku',
    'unit_cost_minor',
    'cost_currency',
    'lead_time_days',
    'is_preferred',
  ],
  external_identifiers: [
    'package_record_id',
    'entity_type',
    'entity_package_record_id',
    'namespace',
    'value',
  ],
  custom_field_values: [
    'package_record_id',
    'entity_type',
    'entity_package_record_id',
    'field_name',
    'value_json',
  ],
  package_diagnostics: [
    'package_record_id',
    'severity',
    'code',
    'message',
    'entity_type',
    'entity_package_record_id',
  ],
} as const;

/**
 * Relationship columns per entity table and the entity table each one must
 * resolve into. References use `package_record_id` values, never Alga IDs.
 */
export const AMP_ENTITY_REFERENCES: Record<
  AmpEntityType,
  ReadonlyArray<{ column: string; targetTable: AmpEntityType; required: boolean }>
> = {
  organizations: [],
  locations: [
    { column: 'organization_package_record_id', targetTable: 'organizations', required: true },
  ],
  contacts: [
    { column: 'organization_package_record_id', targetTable: 'organizations', required: false },
    { column: 'location_package_record_id', targetTable: 'locations', required: false },
  ],
  tickets: [
    { column: 'organization_package_record_id', targetTable: 'organizations', required: false },
    { column: 'location_package_record_id', targetTable: 'locations', required: false },
    { column: 'requester_package_record_id', targetTable: 'contacts', required: false },
  ],
  ticket_comments: [
    { column: 'ticket_package_record_id', targetTable: 'tickets', required: true },
    { column: 'author_package_record_id', targetTable: 'contacts', required: false },
  ],
  assets: [
    { column: 'organization_package_record_id', targetTable: 'organizations', required: false },
    { column: 'location_package_record_id', targetTable: 'locations', required: false },
  ],
  products: [],
  // product_package_record_id is optional at the reference level because a row
  // may instead carry product_sku (matched against the tenant catalog at apply
  // time); the validator enforces "one of the two".
  vendor_products: [
    { column: 'product_package_record_id', targetTable: 'products', required: false },
  ],
};

export const AMP_DIAGNOSTIC_SEVERITIES = ['info', 'warning'] as const;

/**
 * Reserved `extension_json` key carrying the source client/company name from a
 * single-sheet contacts import. AMP v1 contacts have no client-name column and
 * references must resolve inside the package, so the name travels as bounded
 * data and the contacts applier resolves it against existing tenant clients.
 */
export const AMP_CONTACT_CLIENT_NAME_EXTENSION_KEY = '__contact_client_name';

/**
 * Reserved `extension_json` key set by spreadsheet producers when a money
 * column was parsed against an assumed currency (the tenant default) because
 * the row's currency cell was blank. The value is the ISO 4217 code whose
 * minor-unit exponent was used. The applier refuses to apply the amount if the
 * tenant currency at apply time differs, since the minor-unit scale could differ.
 */
export const AMP_ASSUMED_CURRENCY_EXTENSION_KEY = '__assumed_currency';
