import type { AmpEntityType } from './tables';

/** The single row of `amp_manifest`. */
export interface AmpManifest {
  format_version: string;
  package_id: string;
  created_at: string;
  producer_name: string;
  producer_version: string;
  source_system: string;
  source_instance_id?: string | null;
  export_started_at?: string | null;
  export_completed_at?: string | null;
  content_sha256: string;
  capabilities_json?: string | null;
}

/** Columns every canonical entity record carries. */
export interface AmpEntityRecordBase {
  package_record_id: string;
  source_record_id: string;
  external_identifier_namespace: string;
  created_at?: string | null;
  updated_at?: string | null;
  extension_json?: string | null;
}

export interface AmpOrganizationRecord extends AmpEntityRecordBase {
  name: string;
  website?: string | null;
  phone?: string | null;
}

export interface AmpLocationRecord extends AmpEntityRecordBase {
  organization_package_record_id: string;
  name: string;
  address_line1?: string | null;
  address_line2?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

export interface AmpContactRecord extends AmpEntityRecordBase {
  organization_package_record_id?: string | null;
  location_package_record_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  title?: string | null;
}

export interface AmpTicketRecord extends AmpEntityRecordBase {
  organization_package_record_id?: string | null;
  location_package_record_id?: string | null;
  requester_package_record_id?: string | null;
  title: string;
  description?: string | null;
  status_name?: string | null;
  priority_name?: string | null;
  category_name?: string | null;
  closed_at?: string | null;
}

export interface AmpTicketCommentRecord extends AmpEntityRecordBase {
  ticket_package_record_id: string;
  author_package_record_id?: string | null;
  body: string;
  is_internal?: number | null;
}

export interface AmpAssetRecord extends AmpEntityRecordBase {
  organization_package_record_id?: string | null;
  location_package_record_id?: string | null;
  name: string;
  asset_type_name?: string | null;
  serial_number?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  /** Source lifecycle state; mapped to an asset_statuses slug on apply (FR-B2). */
  status?: string | null;
  /** External identifier of the person the asset is assigned to (FR-C3). */
  assignee_external_identifier?: string | null;
  purchase_date?: string | null;
}

/** Money is integer minor units + ISO 4217 code; a null currency means "tenant currency at apply time". */
export interface AmpProductRecord extends AmpEntityRecordBase {
  name: string;
  sku?: string | null;
  category_name?: string | null;
  unit_of_measure?: string | null;
  price_minor?: number | null;
  price_currency?: string | null;
  cost_minor?: number | null;
  cost_currency?: string | null;
  description?: string | null;
  is_active?: number | null;
}

export interface AmpVendorProductRecord extends AmpEntityRecordBase {
  product_package_record_id?: string | null;
  product_sku?: string | null;
  vendor_name: string;
  vendor_sku?: string | null;
  unit_cost_minor?: number | null;
  cost_currency?: string | null;
  lead_time_days?: number | null;
  is_preferred?: number | null;
}

export interface AmpExternalIdentifierRecord {
  package_record_id: string;
  entity_type: AmpEntityType;
  entity_package_record_id: string;
  namespace: string;
  value: string;
}

export interface AmpCustomFieldValueRecord {
  package_record_id: string;
  entity_type: AmpEntityType;
  entity_package_record_id: string;
  field_name: string;
  value_json: string;
}

export interface AmpPackageDiagnosticRecord {
  package_record_id: string;
  severity: 'info' | 'warning';
  code: string;
  message: string;
  entity_type?: AmpEntityType | null;
  entity_package_record_id?: string | null;
}

export interface AmpEntityRecordMap {
  organizations: AmpOrganizationRecord;
  locations: AmpLocationRecord;
  contacts: AmpContactRecord;
  tickets: AmpTicketRecord;
  ticket_comments: AmpTicketCommentRecord;
  assets: AmpAssetRecord;
  products: AmpProductRecord;
  vendor_products: AmpVendorProductRecord;
}

export type AmpEntityRecord = AmpEntityRecordMap[AmpEntityType];

/** Generic compatibility shape for readers and connectors; new domain code
 * should use the table-specific records above. */
export type AmpRecord = AmpEntityRecordBase & Record<string, unknown>;

/** All entity rows of a package, keyed by entity table. */
export type AmpEntityRows = {
  [K in AmpEntityType]?: ReadonlyArray<AmpEntityRecordMap[K]>;
};

/** Auxiliary rows of a package. */
export interface AmpAuxiliaryRows {
  external_identifiers?: ReadonlyArray<AmpExternalIdentifierRecord>;
  custom_field_values?: ReadonlyArray<AmpCustomFieldValueRecord>;
  package_diagnostics?: ReadonlyArray<AmpPackageDiagnosticRecord>;
}

export type AmpPackageRows = AmpEntityRows & AmpAuxiliaryRows;
