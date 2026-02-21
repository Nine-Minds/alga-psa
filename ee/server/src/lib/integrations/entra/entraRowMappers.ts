import type {
  EntraClientTenantMappingRow,
  EntraContactLinkRow,
  EntraContactReconciliationQueueRow,
  EntraManagedTenantRow,
  EntraPartnerConnectionRow,
  EntraSyncRunRow,
  EntraSyncRunTenantRow,
  EntraSyncSettingsRow,
} from '../../../interfaces/entra.interfaces';

type DbRow = Record<string, unknown>;

const toStringValue = (value: unknown, field: string): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw new Error(`Expected ${field} to be a string`);
};

const toNullableStringValue = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const toNumberValue = (value: unknown, field: string): number => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim().length > 0) return Number(value);
  throw new Error(`Expected ${field} to be a number`);
};

const toNullableNumberValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return null;
};

const toBooleanValue = (value: unknown, field: string): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  throw new Error(`Expected ${field} to be a boolean`);
};

const toObjectValue = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const toArrayValue = (value: unknown): unknown[] => {
  return Array.isArray(value) ? value : [];
};

export function mapEntraPartnerConnectionRow(row: DbRow): EntraPartnerConnectionRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    connection_id: toStringValue(row.connection_id, 'connection_id'),
    connection_type: toStringValue(row.connection_type, 'connection_type') as EntraPartnerConnectionRow['connection_type'],
    status: toStringValue(row.status, 'status'),
    is_active: toBooleanValue(row.is_active, 'is_active'),
    cipp_base_url: toNullableStringValue(row.cipp_base_url),
    token_secret_ref: toNullableStringValue(row.token_secret_ref),
    connected_at: toNullableStringValue(row.connected_at),
    disconnected_at: toNullableStringValue(row.disconnected_at),
    last_validated_at: toNullableStringValue(row.last_validated_at),
    last_validation_error: toObjectValue(row.last_validation_error),
    created_by: toNullableStringValue(row.created_by),
    updated_by: toNullableStringValue(row.updated_by),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraManagedTenantRow(row: DbRow): EntraManagedTenantRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    managed_tenant_id: toStringValue(row.managed_tenant_id, 'managed_tenant_id'),
    entra_tenant_id: toStringValue(row.entra_tenant_id, 'entra_tenant_id'),
    display_name: toNullableStringValue(row.display_name),
    primary_domain: toNullableStringValue(row.primary_domain),
    source_user_count: toNumberValue(row.source_user_count ?? 0, 'source_user_count'),
    discovered_at: toStringValue(row.discovered_at, 'discovered_at'),
    last_seen_at: toStringValue(row.last_seen_at, 'last_seen_at'),
    metadata: toObjectValue(row.metadata),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraClientTenantMappingRow(row: DbRow): EntraClientTenantMappingRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    mapping_id: toStringValue(row.mapping_id, 'mapping_id'),
    managed_tenant_id: toStringValue(row.managed_tenant_id, 'managed_tenant_id'),
    client_id: toNullableStringValue(row.client_id),
    mapping_state: toStringValue(row.mapping_state, 'mapping_state') as EntraClientTenantMappingRow['mapping_state'],
    confidence_score: toNullableNumberValue(row.confidence_score),
    is_active: toBooleanValue(row.is_active, 'is_active'),
    decided_by: toNullableStringValue(row.decided_by),
    decided_at: toNullableStringValue(row.decided_at),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraSyncSettingsRow(row: DbRow): EntraSyncSettingsRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    settings_id: toStringValue(row.settings_id, 'settings_id'),
    sync_enabled: toBooleanValue(row.sync_enabled, 'sync_enabled'),
    sync_interval_minutes: toNumberValue(row.sync_interval_minutes, 'sync_interval_minutes'),
    field_sync_config: toObjectValue(row.field_sync_config),
    user_filter_config: toObjectValue(row.user_filter_config),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraSyncRunRow(row: DbRow): EntraSyncRunRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    run_id: toStringValue(row.run_id, 'run_id'),
    workflow_id: toNullableStringValue(row.workflow_id),
    run_type: toStringValue(row.run_type, 'run_type'),
    status: toStringValue(row.status, 'status') as EntraSyncRunRow['status'],
    initiated_by: toNullableStringValue(row.initiated_by),
    started_at: toStringValue(row.started_at, 'started_at'),
    completed_at: toNullableStringValue(row.completed_at),
    total_tenants: toNumberValue(row.total_tenants ?? 0, 'total_tenants'),
    processed_tenants: toNumberValue(row.processed_tenants ?? 0, 'processed_tenants'),
    succeeded_tenants: toNumberValue(row.succeeded_tenants ?? 0, 'succeeded_tenants'),
    failed_tenants: toNumberValue(row.failed_tenants ?? 0, 'failed_tenants'),
    summary: toObjectValue(row.summary),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraSyncRunTenantRow(row: DbRow): EntraSyncRunTenantRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    run_tenant_id: toStringValue(row.run_tenant_id, 'run_tenant_id'),
    run_id: toStringValue(row.run_id, 'run_id'),
    managed_tenant_id: toNullableStringValue(row.managed_tenant_id),
    client_id: toNullableStringValue(row.client_id),
    status: toStringValue(row.status, 'status') as EntraSyncRunTenantRow['status'],
    created_count: toNumberValue(row.created_count ?? 0, 'created_count'),
    linked_count: toNumberValue(row.linked_count ?? 0, 'linked_count'),
    updated_count: toNumberValue(row.updated_count ?? 0, 'updated_count'),
    ambiguous_count: toNumberValue(row.ambiguous_count ?? 0, 'ambiguous_count'),
    inactivated_count: toNumberValue(row.inactivated_count ?? 0, 'inactivated_count'),
    error_message: toNullableStringValue(row.error_message),
    started_at: toNullableStringValue(row.started_at),
    completed_at: toNullableStringValue(row.completed_at),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraContactLinkRow(row: DbRow): EntraContactLinkRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    link_id: toStringValue(row.link_id, 'link_id'),
    contact_name_id: toStringValue(row.contact_name_id, 'contact_name_id'),
    client_id: toNullableStringValue(row.client_id),
    entra_tenant_id: toStringValue(row.entra_tenant_id, 'entra_tenant_id'),
    entra_object_id: toStringValue(row.entra_object_id, 'entra_object_id'),
    link_status: toStringValue(row.link_status, 'link_status') as EntraContactLinkRow['link_status'],
    is_active: toBooleanValue(row.is_active, 'is_active'),
    last_seen_at: toNullableStringValue(row.last_seen_at),
    last_synced_at: toNullableStringValue(row.last_synced_at),
    metadata: toObjectValue(row.metadata),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}

export function mapEntraContactReconciliationQueueRow(
  row: DbRow
): EntraContactReconciliationQueueRow {
  return {
    tenant: toStringValue(row.tenant, 'tenant'),
    queue_item_id: toStringValue(row.queue_item_id, 'queue_item_id'),
    managed_tenant_id: toNullableStringValue(row.managed_tenant_id),
    client_id: toNullableStringValue(row.client_id),
    entra_tenant_id: toStringValue(row.entra_tenant_id, 'entra_tenant_id'),
    entra_object_id: toStringValue(row.entra_object_id, 'entra_object_id'),
    user_principal_name: toNullableStringValue(row.user_principal_name),
    display_name: toNullableStringValue(row.display_name),
    email: toNullableStringValue(row.email),
    candidate_contacts: toArrayValue(row.candidate_contacts),
    status: toStringValue(row.status, 'status') as EntraContactReconciliationQueueRow['status'],
    resolution_action: toNullableStringValue(row.resolution_action),
    resolved_contact_id: toNullableStringValue(row.resolved_contact_id),
    resolved_by: toNullableStringValue(row.resolved_by),
    resolved_at: toNullableStringValue(row.resolved_at),
    payload: toObjectValue(row.payload),
    created_at: toStringValue(row.created_at, 'created_at'),
    updated_at: toStringValue(row.updated_at, 'updated_at'),
  };
}
