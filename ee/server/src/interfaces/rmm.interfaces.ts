/**
 * RMM (Remote Monitoring and Management) Integration Interfaces
 *
 * These interfaces define the data structures for RMM integrations,
 * currently supporting NinjaOne with extensibility for other providers.
 */

// Provider types
export type RmmProvider = 'ninjaone' | 'datto' | 'connectwise_automate';
export type RmmSyncStatus = 'pending' | 'syncing' | 'completed' | 'error';
export type RmmAlertSeverity = 'critical' | 'major' | 'moderate' | 'minor' | 'none';
export type RmmAlertStatus = 'active' | 'acknowledged' | 'resolved' | 'auto_resolved';
export type RmmAgentStatus = 'online' | 'offline' | 'unknown';

// Core RMM Integration
export interface RmmIntegration {
  tenant: string;
  integration_id: string;
  provider: RmmProvider;
  instance_url?: string;
  is_active: boolean;
  connected_at?: string;
  last_sync_at?: string;
  sync_status?: RmmSyncStatus;
  sync_error?: string;
  settings: RmmIntegrationSettings;
  created_at: string;
  updated_at: string;
}

export interface RmmIntegrationSettings {
  sync_interval_minutes?: number;
  webhook_enabled?: boolean;
  webhook_secret?: string;
  auto_create_assets?: boolean;
  auto_sync_organizations?: boolean;
  default_asset_status?: string;
  // NinjaOne specific
  ninja_instance_region?: string;
  // Future provider-specific settings can be added here
}

// Organization Mapping
export interface RmmOrganizationMapping {
  tenant: string;
  mapping_id: string;
  integration_id: string;
  external_organization_id: string;
  external_organization_name?: string;
  client_id?: string;
  auto_sync_assets: boolean;
  auto_create_tickets?: boolean;
  last_synced_at?: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
  // Joined data
  company_name?: string;
}

// Alerts
export interface RmmAlert {
  tenant: string;
  alert_id: string;
  integration_id: string;
  external_alert_id: string;
  external_device_id?: string;
  asset_id?: string;
  severity: string;
  priority?: string;
  activity_type: string;
  status: string;
  message?: string;
  source_data?: string | Record<string, unknown>;
  ticket_id?: string;
  auto_ticket_created?: boolean;
  triggered_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolved_by?: string;
  created_at?: string;
  updated_at?: string;
  // Joined data
  asset_name?: string;
  ticket_title?: string;
}

// Alert Rules
export interface RmmAlertRule {
  tenant: string;
  rule_id: string;
  integration_id: string;
  name: string;
  description?: string;
  is_active: boolean;
  priority_order: number;
  conditions: RmmAlertRuleConditions | string;
  actions: RmmAlertRuleActions | string;
  created_at?: string;
  updated_at?: string;
}

// Alert Rule Conditions (stored as JSONB)
export interface RmmAlertRuleConditions {
  severities?: string[];
  activityTypes?: string[];
  organizationIds?: string[];
  statusCodes?: string[];
  keywords?: string[];
}

// Alert Rule Actions (stored as JSONB)
export interface RmmAlertRuleActions {
  createTicket?: boolean;
  ticketPriority?: string;
  assignToChannel?: string;
  assignToUser?: string;
  notifyUsers?: string[];
  addToBoard?: string;
  webhookUrl?: string;
  customFields?: Record<string, unknown>;
}

export interface RmmAlertRuleTicketTemplate {
  title_template?: string;
  description_template?: string;
  tags?: string[];
}

// Extended Asset Fields (for augmenting existing Asset interface)
export interface RmmAssetFields {
  rmm_provider?: RmmProvider;
  rmm_device_id?: string;
  rmm_organization_id?: string;
  agent_status?: RmmAgentStatus;
  last_seen_at?: string;
  last_rmm_sync_at?: string;
}

export interface RmmWorkstationFields {
  agent_version?: string;
  antivirus_status?: string;
  antivirus_product?: string;
  last_reboot_at?: string;
  pending_patches?: number;
  failed_patches?: number;
  last_patch_scan_at?: string;
  system_info?: Record<string, unknown>;
}

export interface RmmServerFields extends RmmWorkstationFields {
  disk_usage?: RmmDiskUsage[];
  cpu_usage_percent?: number;
  memory_usage_percent?: number;
}

export interface RmmDiskUsage {
  drive: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent_used: number;
}

// Request/Response interfaces
export interface CreateRmmIntegrationRequest {
  provider: RmmProvider;
  instance_url?: string;
  settings?: Partial<RmmIntegrationSettings>;
}

export interface UpdateRmmIntegrationRequest {
  instance_url?: string;
  is_active?: boolean;
  settings?: Partial<RmmIntegrationSettings>;
}

export interface CreateRmmOrganizationMappingRequest {
  integration_id: string;
  external_organization_id: string;
  external_organization_name?: string;
  company_id?: string;
  auto_sync_assets?: boolean;
  auto_create_tickets?: boolean;
}

export interface UpdateRmmOrganizationMappingRequest {
  company_id?: string;
  auto_sync_assets?: boolean;
  auto_create_tickets?: boolean;
}

export interface CreateRmmAlertRuleRequest {
  integration_id: string;
  name: string;
  description?: string;
  is_active?: boolean;
  priority_order?: number;
  severity_filter?: string[];
  source_type_filter?: string[];
  alert_class_filter?: string[];
  organization_filter?: string[];
  message_pattern?: string;
  create_ticket?: boolean;
  ticket_channel_id?: string;
  ticket_priority?: string;
  assigned_user_id?: string;
  ticket_template?: RmmAlertRuleTicketTemplate;
  auto_resolve_ticket?: boolean;
}

export interface UpdateRmmAlertRuleRequest extends Partial<CreateRmmAlertRuleRequest> {
  rule_id: string;
}

// Query parameters
export interface RmmAlertQueryParams {
  status?: RmmAlertStatus | RmmAlertStatus[];
  severity?: RmmAlertSeverity | RmmAlertSeverity[];
  asset_id?: string;
  has_ticket?: boolean;
  from_date?: string;
  to_date?: string;
  page?: number;
  limit?: number;
}

export interface RmmOrganizationQueryParams {
  integration_id?: string;
  mapped_only?: boolean;
  unmapped_only?: boolean;
  page?: number;
  limit?: number;
}

// List responses
export interface RmmAlertListResponse {
  alerts: RmmAlert[];
  total: number;
  page: number;
  limit: number;
}

export interface RmmOrganizationListResponse {
  organizations: RmmOrganizationMapping[];
  total: number;
  page: number;
  limit: number;
}

// Sync status
export interface RmmSyncResult {
  success: boolean;
  provider?: RmmProvider;
  sync_type: 'full' | 'incremental' | 'organizations' | 'devices' | 'alerts';
  started_at: string;
  completed_at?: string;
  items_processed: number;
  items_created: number;
  items_updated: number;
  items_deleted?: number;
  items_failed: number;
  errors?: string[];
}

// Connection status for UI
export interface RmmConnectionStatus {
  provider: RmmProvider;
  is_connected: boolean;
  is_active: boolean;
  instance_url?: string;
  connected_at?: string;
  last_sync_at?: string;
  sync_status?: RmmSyncStatus;
  sync_error?: string;
  organization_count?: number;
  device_count?: number;
  active_alert_count?: number;
}

// Remote access
export interface RmmRemoteAccessLink {
  url: string;
  expires_at?: string;
  connection_type: 'splashtop' | 'teamviewer' | 'vnc' | 'rdp' | 'shell';
}

// Webhook payload types (for inbound webhooks from RMM)
export interface RmmWebhookPayload {
  provider: RmmProvider;
  event_type: string;
  timestamp: string;
  payload: Record<string, unknown>;
  signature?: string;
}

// Type guards
export function isRmmIntegration(obj: unknown): obj is RmmIntegration {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'tenant' in obj &&
    'integration_id' in obj &&
    'provider' in obj
  );
}

export function isRmmAlert(obj: unknown): obj is RmmAlert {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'alert_id' in obj &&
    'external_alert_id' in obj &&
    'severity' in obj
  );
}

export function isRmmOrganizationMapping(obj: unknown): obj is RmmOrganizationMapping {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    'mapping_id' in obj &&
    'external_organization_id' in obj
  );
}
