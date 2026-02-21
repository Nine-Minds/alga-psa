export type EntraConnectionType = 'direct' | 'cipp';

export type EntraMappingState =
  | 'mapped'
  | 'needs_review'
  | 'skipped'
  | 'skip_for_now'
  | 'unmapped';

export type EntraSyncRunStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed';

export type EntraLinkStatus = 'active' | 'inactive' | 'orphaned';

export type EntraReconciliationStatus = 'open' | 'resolved' | 'dismissed';

export interface EntraPartnerConnectionRow {
  tenant: string;
  connection_id: string;
  connection_type: EntraConnectionType;
  status: string;
  is_active: boolean;
  cipp_base_url: string | null;
  token_secret_ref: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  last_validated_at: string | null;
  last_validation_error: Record<string, unknown>;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntraManagedTenantRow {
  tenant: string;
  managed_tenant_id: string;
  entra_tenant_id: string;
  display_name: string | null;
  primary_domain: string | null;
  source_user_count: number;
  discovered_at: string;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntraClientTenantMappingRow {
  tenant: string;
  mapping_id: string;
  managed_tenant_id: string;
  client_id: string | null;
  mapping_state: EntraMappingState;
  confidence_score: number | null;
  is_active: boolean;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntraSyncSettingsRow {
  tenant: string;
  settings_id: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  field_sync_config: Record<string, unknown>;
  user_filter_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntraSyncRunRow {
  tenant: string;
  run_id: string;
  workflow_id: string | null;
  run_type: string;
  status: EntraSyncRunStatus | string;
  initiated_by: string | null;
  started_at: string;
  completed_at: string | null;
  total_tenants: number;
  processed_tenants: number;
  succeeded_tenants: number;
  failed_tenants: number;
  summary: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntraSyncRunTenantRow {
  tenant: string;
  run_tenant_id: string;
  run_id: string;
  managed_tenant_id: string | null;
  client_id: string | null;
  status: EntraSyncRunStatus | string;
  created_count: number;
  linked_count: number;
  updated_count: number;
  ambiguous_count: number;
  inactivated_count: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EntraContactLinkRow {
  tenant: string;
  link_id: string;
  contact_name_id: string;
  client_id: string | null;
  entra_tenant_id: string;
  entra_object_id: string;
  link_status: EntraLinkStatus | string;
  is_active: boolean;
  last_seen_at: string | null;
  last_synced_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntraContactReconciliationQueueRow {
  tenant: string;
  queue_item_id: string;
  managed_tenant_id: string | null;
  client_id: string | null;
  entra_tenant_id: string;
  entra_object_id: string;
  user_principal_name: string | null;
  display_name: string | null;
  email: string | null;
  candidate_contacts: unknown[];
  status: EntraReconciliationStatus | string;
  resolution_action: string | null;
  resolved_contact_id: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
