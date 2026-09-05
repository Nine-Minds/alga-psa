import {
  AMP_ENTITY_TABLES,
  AMP_TABLE_COLUMNS,
  AMP_ENTITY_IDENTITY_COLUMNS,
  AMP_DIAGNOSTIC_SEVERITIES,
  type AmpEntityType,
} from './tables';
import { AMP_LIMITS } from './limits';

/**
 * JSON Schema (draft 2020-12) for value/semantic validation of package rows.
 * These schemas describe individual rows after SQLite extraction; structural
 * concerns (allowlisted tables, forbidden objects, row counts) are enforced
 * separately by the package validator.
 */

const OPAQUE_ID = {
  type: 'string',
  minLength: 1,
  maxLength: AMP_LIMITS.opaqueIdBytes,
} as const;

const RFC3339_UTC = {
  type: ['string', 'null'],
  pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$',
} as const;

const DATE_ONLY = {
  type: ['string', 'null'],
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
} as const;

const BOUNDED_TEXT = {
  type: ['string', 'null'],
  maxLength: AMP_LIMITS.textBytes,
} as const;

const REQUIRED_TEXT = {
  type: 'string',
  minLength: 1,
  maxLength: AMP_LIMITS.textBytes,
} as const;

const EXTENSION_JSON = {
  type: ['string', 'null'],
  maxLength: AMP_LIMITS.extensionJsonBytes,
} as const;

const NULLABLE_OPAQUE_ID = {
  type: ['string', 'null'],
  minLength: 1,
  maxLength: AMP_LIMITS.opaqueIdBytes,
} as const;

const ENTITY_BASE_PROPERTIES = {
  package_record_id: OPAQUE_ID,
  source_record_id: OPAQUE_ID,
  external_identifier_namespace: OPAQUE_ID,
  created_at: RFC3339_UTC,
  updated_at: RFC3339_UTC,
  extension_json: EXTENSION_JSON,
} as const;

const ENTITY_EXTRA_PROPERTIES: Record<AmpEntityType, Record<string, unknown>> = {
  organizations: {
    name: REQUIRED_TEXT,
    website: BOUNDED_TEXT,
    phone: BOUNDED_TEXT,
  },
  locations: {
    organization_package_record_id: OPAQUE_ID,
    name: REQUIRED_TEXT,
    address_line1: BOUNDED_TEXT,
    address_line2: BOUNDED_TEXT,
    city: BOUNDED_TEXT,
    region: BOUNDED_TEXT,
    postal_code: BOUNDED_TEXT,
    country_code: { type: ['string', 'null'], pattern: '^[A-Z]{2}$' },
    phone: BOUNDED_TEXT,
  },
  contacts: {
    organization_package_record_id: NULLABLE_OPAQUE_ID,
    location_package_record_id: NULLABLE_OPAQUE_ID,
    first_name: BOUNDED_TEXT,
    last_name: BOUNDED_TEXT,
    email: BOUNDED_TEXT,
    phone: BOUNDED_TEXT,
    title: BOUNDED_TEXT,
  },
  tickets: {
    organization_package_record_id: NULLABLE_OPAQUE_ID,
    location_package_record_id: NULLABLE_OPAQUE_ID,
    requester_package_record_id: NULLABLE_OPAQUE_ID,
    title: REQUIRED_TEXT,
    description: BOUNDED_TEXT,
    status_name: BOUNDED_TEXT,
    priority_name: BOUNDED_TEXT,
    category_name: BOUNDED_TEXT,
    closed_at: RFC3339_UTC,
  },
  ticket_comments: {
    ticket_package_record_id: OPAQUE_ID,
    author_package_record_id: NULLABLE_OPAQUE_ID,
    body: REQUIRED_TEXT,
    is_internal: { type: ['integer', 'null'], enum: [0, 1, null] },
  },
  assets: {
    organization_package_record_id: NULLABLE_OPAQUE_ID,
    location_package_record_id: NULLABLE_OPAQUE_ID,
    name: REQUIRED_TEXT,
    asset_type_name: BOUNDED_TEXT,
    serial_number: BOUNDED_TEXT,
    manufacturer: BOUNDED_TEXT,
    model: BOUNDED_TEXT,
    purchase_date: DATE_ONLY,
  },
};

function requiredColumns(table: AmpEntityType): string[] {
  const extras = ENTITY_EXTRA_PROPERTIES[table];
  const requiredExtras = Object.entries(extras)
    .filter(([, schema]) => (schema as { type?: unknown }).type === 'string')
    .map(([column]) => column);
  return ['package_record_id', 'source_record_id', 'external_identifier_namespace', ...requiredExtras];
}

function entityRowSchema(table: AmpEntityType): Record<string, unknown> {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `https://spec.algapsa.com/amp/v1/${table}.json`,
    type: 'object',
    properties: { ...ENTITY_BASE_PROPERTIES, ...ENTITY_EXTRA_PROPERTIES[table] },
    required: requiredColumns(table),
    additionalProperties: false,
  };
}

/** Row schema per canonical entity table. */
export const AMP_ENTITY_ROW_SCHEMAS: Record<AmpEntityType, Record<string, unknown>> =
  Object.fromEntries(AMP_ENTITY_TABLES.map((table) => [table, entityRowSchema(table)])) as Record<
    AmpEntityType,
    Record<string, unknown>
  >;

/** Row schema for the manifest table. */
export const AMP_MANIFEST_SCHEMA: Record<string, unknown> = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://spec.algapsa.com/amp/v1/amp_manifest.json',
  type: 'object',
  properties: {
    format_version: { type: 'string', pattern: '^\\d+\\.\\d+\\.\\d+$' },
    package_id: OPAQUE_ID,
    created_at: { type: 'string', pattern: RFC3339_UTC.pattern },
    producer_name: REQUIRED_TEXT,
    producer_version: REQUIRED_TEXT,
    source_system: REQUIRED_TEXT,
    source_instance_id: NULLABLE_OPAQUE_ID,
    export_started_at: RFC3339_UTC,
    export_completed_at: RFC3339_UTC,
    content_sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
    capabilities_json: EXTENSION_JSON,
  },
  required: [
    'format_version',
    'package_id',
    'created_at',
    'producer_name',
    'producer_version',
    'source_system',
    'content_sha256',
  ],
  additionalProperties: false,
};

/** Row schemas for auxiliary tables. */
export const AMP_AUXILIARY_ROW_SCHEMAS: Record<string, Record<string, unknown>> = {
  external_identifiers: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://spec.algapsa.com/amp/v1/external_identifiers.json',
    type: 'object',
    properties: {
      package_record_id: OPAQUE_ID,
      entity_type: { type: 'string', enum: [...AMP_ENTITY_TABLES] },
      entity_package_record_id: OPAQUE_ID,
      namespace: OPAQUE_ID,
      value: REQUIRED_TEXT,
    },
    required: ['package_record_id', 'entity_type', 'entity_package_record_id', 'namespace', 'value'],
    additionalProperties: false,
  },
  custom_field_values: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://spec.algapsa.com/amp/v1/custom_field_values.json',
    type: 'object',
    properties: {
      package_record_id: OPAQUE_ID,
      entity_type: { type: 'string', enum: [...AMP_ENTITY_TABLES] },
      entity_package_record_id: OPAQUE_ID,
      field_name: REQUIRED_TEXT,
      value_json: { type: 'string', maxLength: AMP_LIMITS.extensionJsonBytes },
    },
    required: ['package_record_id', 'entity_type', 'entity_package_record_id', 'field_name', 'value_json'],
    additionalProperties: false,
  },
  package_diagnostics: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://spec.algapsa.com/amp/v1/package_diagnostics.json',
    type: 'object',
    properties: {
      package_record_id: OPAQUE_ID,
      severity: { type: 'string', enum: [...AMP_DIAGNOSTIC_SEVERITIES] },
      code: REQUIRED_TEXT,
      message: REQUIRED_TEXT,
      entity_type: { type: ['string', 'null'], enum: [...AMP_ENTITY_TABLES, null] },
      entity_package_record_id: NULLABLE_OPAQUE_ID,
    },
    required: ['package_record_id', 'severity', 'code', 'message'],
    additionalProperties: false,
  },
};

/** Sanity guard: schemas and column allowlists must agree. */
for (const table of AMP_ENTITY_TABLES) {
  const schemaColumns = Object.keys(
    (AMP_ENTITY_ROW_SCHEMAS[table] as { properties: Record<string, unknown> }).properties
  ).sort();
  const specColumns = [...AMP_TABLE_COLUMNS[table]].sort();
  if (JSON.stringify(schemaColumns) !== JSON.stringify(specColumns)) {
    throw new Error(`AMP JSON Schema for ${table} disagrees with AMP_TABLE_COLUMNS`);
  }
}
