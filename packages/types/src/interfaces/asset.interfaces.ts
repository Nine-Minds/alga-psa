// Asset interfaces
export interface AssetHistory {
  tenant: string;
  history_id: string;
  asset_id: string;
  changed_by: string;
  changed_by_name?: string; // User's full name (first_name + last_name)
  change_type: string;
  changes: Record<string, unknown>;
  changed_at: string;
}

export interface AssetRelationship {
  tenant: string;
  parent_asset_id: string;
  child_asset_id: string;
  relationship_type: string;
  created_at: string;
  updated_at: string;
  name: string; // Name of the related asset
}

// RMM Provider types
export type RmmProvider = 'ninjaone' | 'tacticalrmm' | 'tanium' | 'levelio' | 'datto' | 'connectwise_automate' | 'huntress';
export type RmmAgentStatus = 'online' | 'offline' | 'overdue' | 'unknown';
export interface AssetRemoteAccessLink {
  link_id: string;
  label: string;
  url_template: string;
}
export type AssetFactSourceType = 'integration' | 'manual' | 'system';

export interface AssetFact {
  asset_fact_id: string;
  tenant: string;
  asset_id: string;
  source_type: AssetFactSourceType;
  provider?: string | null;
  integration_id?: string | null;
  namespace: string;
  fact_key: string;
  label: string;
  value_text?: string | null;
  value_number?: number | null;
  value_bool?: boolean | null;
  value_json: Record<string, unknown>;
  source: string;
  source_updated_at?: string | null;
  last_synced_at?: string | null;
  is_available: boolean;
  created_at: string;
  updated_at: string;
}

export interface Asset {
  asset_id: string;
  /** Registry slug: a built-in or a custom tenant asset_type_registry type. */
  asset_type: string;
  client_id: string;
  asset_tag: string;
  serial_number?: string;
  name: string;
  status: string;
  /** Who owns the device: the client (default) or the MSP. Custody intake only ever handles client-owned devices. */
  ownership?: 'client' | 'msp';
  location_id?: string | null;
  /** The one contact this asset is assigned to (portal asset scope). */
  contact_name_id?: string | null;
  /** Display name of the assigned contact; read-only, joined on read. */
  contact_name?: string | null;
  /** The group this asset belongs to, when it has one; read-only. */
  group?: AssetGroupSummary | null;
  location?: string;
  purchase_date?: string;
  warranty_end_date?: string;
  /** Hardware make, a first-class column (RMM sync and imports fill it). */
  manufacturer?: string | null;
  /** Hardware model, a first-class column (no system_info fallback). */
  model?: string | null;
  /** Supplier, an inventory `vendors` row. */
  vendor_id?: string | null;
  /** Supplier name; read-only, joined on read. */
  vendor_name?: string | null;
  /** Purchase cost in minor units (cents). */
  purchase_cost?: number | null;
  purchase_cost_currency?: string | null;
  order_number?: string | null;
  /** Billing profile this device's work is attributed to (FR-F1). */
  billing_profile_id?: string | null;
  /** Profile name; read-only, joined on read. */
  billing_profile_name?: string | null;
  created_at: string;
  updated_at: string;
  tenant: string;
  // RMM Integration fields
  rmm_provider?: RmmProvider;
  rmm_device_id?: string;
  rmm_organization_id?: string;
  agent_status?: RmmAgentStatus;
  last_seen_at?: string;
  last_rmm_sync_at?: string;
  // Notes document (BlockNote format, like company notes)
  notes_document_id?: string;
  // Integration extras (namespaced jsonb, e.g. hudu_fields/hudu_synced_at)
  attributes?: Record<string, unknown> | null;
  // Related data
  client?: AssetClientInfo;
  relationships?: AssetRelationship[];
  workstation?: WorkstationAsset;
  network_device?: NetworkDeviceAsset;
  server?: ServerAsset;
  mobile_device?: MobileDeviceAsset;
  printer?: PrinterAsset;
}

export interface AssetClientInfo {
  client_id: string;
  client_name: string;
}

// Extension table interfaces
export interface WorkstationAsset {
  tenant: string;
  asset_id: string;
  os_type: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number | null;
  ram_gb: number | null;
  storage_type: string;
  storage_capacity_gb: number | null;
  gpu_model?: string;
  last_login?: string;
  installed_software: unknown[];
  // RMM Integration fields
  agent_version?: string;
  antivirus_status?: string;
  antivirus_product?: string;
  last_reboot_at?: string;
  pending_patches?: number;
  pending_os_patches?: number;
  pending_software_patches?: number;
  failed_patches?: number;
  last_patch_scan_at?: string;
  system_info?: Record<string, unknown>;
  // Cached RMM live data (synced from RMM)
  current_user?: string;
  uptime_seconds?: number;
  lan_ip?: string;
  wan_ip?: string;
  cpu_utilization_percent?: number;
  memory_usage_percent?: number;
  memory_used_gb?: number;
  disk_usage?: RmmStorageInfo[];
}

export interface NetworkDeviceAsset {
  tenant: string;
  asset_id: string;
  device_type: 'switch' | 'router' | 'firewall' | 'access_point' | 'load_balancer';
  management_ip: string;
  port_count: number | null;
  firmware_version: string;
  supports_poe: boolean;
  power_draw_watts: number | null;
  vlan_config: Record<string, unknown>;
  port_config: Record<string, unknown>;
}

export interface ServerAsset {
  tenant: string;
  asset_id: string;
  os_type: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number | null;
  ram_gb: number | null;
  storage_config: unknown[];
  raid_config?: string;
  is_virtual: boolean;
  hypervisor?: string;
  network_interfaces: unknown[];
  primary_ip?: string;
  installed_services: unknown[];
  installed_software?: unknown[];
  // RMM Integration fields
  agent_version?: string;
  antivirus_status?: string;
  antivirus_product?: string;
  last_reboot_at?: string;
  pending_patches?: number;
  pending_os_patches?: number;
  pending_software_patches?: number;
  failed_patches?: number;
  last_patch_scan_at?: string;
  system_info?: Record<string, unknown>;
  disk_usage?: RmmStorageInfo[];
  cpu_usage_percent?: number;
  memory_usage_percent?: number;
  // Cached RMM live data (synced from RMM)
  current_user?: string;
  uptime_seconds?: number;
  lan_ip?: string;
  wan_ip?: string;
  memory_used_gb?: number;
}

export interface DiskUsageInfo {
  drive: string;
  total_gb: number;
  used_gb: number;
  free_gb: number;
  percent_used: number;
}

// RMM Storage info (used for cached disk usage from RMM sync)
export interface RmmStorageInfo {
  name: string;
  total_gb: number;
  /** Absent when the provider reports capacity only (e.g. Level.io `disks`). */
  free_gb?: number | null;
  /** Absent when free space is unknown; never substitute 0. */
  utilization_percent?: number | null;
}

// Cached RMM data structure (returned by getAssetRmmData)
export interface RmmCachedData {
  provider: RmmProvider;
  agent_status: RmmAgentStatus;
  last_check_in: string | null;
  last_rmm_sync_at: string | null;
  current_user: string | null;
  uptime_seconds: number | null;
  lan_ip: string | null;
  wan_ip: string | null;
  cpu_utilization_percent: number | null;
  memory_utilization_percent: number | null;
  memory_used_gb: number | null;
  memory_total_gb: number | null;
  storage: RmmStorageInfo[];
}

// Asset summary metrics (for the key metrics banner)
export type HealthStatus = 'healthy' | 'warning' | 'critical' | 'unknown';
export type SecurityStatus = 'secure' | 'at_risk' | 'critical';
export type WarrantyStatus = 'active' | 'expiring_soon' | 'expired' | 'unknown';

export interface AssetSummaryMetrics {
  health_status: HealthStatus;
  health_reason: string | null;
  open_tickets_count: number;
  security_status: SecurityStatus;
  security_issues: string[];
  warranty_days_remaining: number | null;
  warranty_status: WarrantyStatus;
}

export interface MobileDeviceAsset {
  tenant: string;
  asset_id: string;
  os_type: string;
  os_version: string;
  model: string;
  imei?: string;
  phone_number?: string;
  carrier?: string;
  last_check_in?: string;
  is_supervised: boolean;
  installed_apps: unknown[];
}

export interface PrinterAsset {
  tenant: string;
  asset_id: string;
  model: string;
  ip_address?: string;
  is_network_printer: boolean;
  supports_color: boolean;
  supports_duplex: boolean;
  max_paper_size?: number | null;
  supported_paper_types: unknown[];
  monthly_duty_cycle?: number | null;
  supply_levels: Record<string, unknown>;
}

// Asset Association interfaces
export interface AssetAssociation {
  tenant: string;
  asset_id: string;
  entity_id: string;
  entity_type: 'ticket' | 'project';
  relationship_type: string;
  created_by: string;
  created_at: string;
  asset?: Asset;
}

export interface AssetTicketSummary {
  ticket_id: string;
  title: string;
  status_id: string;
  status_name: string;
  priority_id?: string;
  priority_name?: string;
  linked_at: string;
  updated_at?: string;
  client_name?: string;
  assigned_to_name?: string;
  relationship_type?: string;
}

export interface AssetDocument {
  tenant: string;
  association_id: string;
  asset_id: string;
  document_id: string;
  notes?: string;
  created_by: string;
  created_at: string;
  document_name: string;
  mime_type: string;
  file_size: number;
}

// Maintenance interfaces
export type MaintenanceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
/**
 * Must stay in step with the maintenance_type CHECK on
 * asset_maintenance_schedules / asset_maintenance_history and with the API Zod
 * enum in server/src/lib/api/schemas/asset.ts. 'corrective' was accepted by the
 * API and the mobile client while the DB rejected it — see migration
 * 20260728100000_allow_corrective_maintenance_type.
 */
export type MaintenanceType = 'preventive' | 'corrective' | 'inspection' | 'calibration' | 'replacement';
export type MaintenanceStatus = 'due' | 'overdue' | 'upcoming' | 'completed';

export interface AssetMaintenanceSchedule {
  tenant: string;
  schedule_id: string;
  asset_id: string;
  schedule_name: string;
  description?: string;
  maintenance_type: MaintenanceType;
  frequency: MaintenanceFrequency;
  frequency_interval: number;
  schedule_config: Record<string, unknown>;
  next_maintenance: string;
  last_maintenance?: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at?: string;
}

export type AssetMaintenanceOccurrenceStatus = 'open' | 'completed' | 'skipped' | 'cancelled';

export interface AssetMaintenanceOccurrence {
  tenant: string;
  occurrence_id: string;
  schedule_id: string;
  asset_id: string;
  due_date: string;
  status: AssetMaintenanceOccurrenceStatus;
  ticket_id?: string;
  history_id?: string;
  skip_reason?: string;
  closed_at?: string;
  closed_by?: string;
  created_at: string;
  updated_at: string;
  schedule_name?: string;
  maintenance_type?: MaintenanceType;
  frequency?: MaintenanceFrequency;
  frequency_interval?: number;
  schedule_config?: Record<string, unknown>;
  last_maintenance?: string;
  asset_name?: string;
  asset_type?: string;
  asset_tag?: string;
  asset_location?: string;
  client_id?: string;
  client_name?: string;
  ticket_title?: string;
  ticket_number?: string;
  ticket_closed?: boolean;
  ticket_assigned_to?: string;
  ticket_assignee_first_name?: string;
  ticket_assignee_last_name?: string;
  schedule_created_by_first_name?: string;
  schedule_created_by_last_name?: string;
  performed_at?: string;
  performed_by?: string;
  performed_by_first_name?: string;
  performed_by_last_name?: string;
  completion_notes?: string;
  maintenance_data?: Record<string, unknown>;
  closed_by_first_name?: string;
  closed_by_last_name?: string;
}

export interface MaintenanceOccurrenceFilters {
  status?: AssetMaintenanceOccurrenceStatus[];
  client_id?: string;
  asset_id?: string;
  asset_type?: string;
  maintenance_type?: MaintenanceType;
  due_from?: string;
  due_to?: string;
  search?: string;
  page?: number;
  limit?: number;
}

export interface MaintenanceOccurrenceListResult {
  occurrences: AssetMaintenanceOccurrence[];
  total: number;
}

export interface MaintenanceAggregates {
  overdue: number;
  due_today: number;
  upcoming_7d: number;
  open_maintenance_tickets: number;
  compliance_90d: number;
}

export interface AssetMaintenanceHistory {
  tenant: string;
  history_id: string;
  asset_id: string;
  schedule_id: string;
  performed_at: string;
  performed_by: string;
  performed_by_name?: string;
  notes?: string;
  maintenance_data: Record<string, unknown>;
  created_at: string;
}

// Type guards
export function isWorkstationAsset(asset: unknown): asset is WorkstationAsset {
  return (
    typeof asset === 'object' &&
    asset !== null &&
    'os_type' in asset &&
    'cpu_model' in asset &&
    'ram_gb' in asset
  );
}

export function isNetworkDeviceAsset(asset: unknown): asset is NetworkDeviceAsset {
  return (
    typeof asset === 'object' &&
    asset !== null &&
    'device_type' in asset &&
    'management_ip' in asset &&
    'port_count' in asset
  );
}

export function isServerAsset(asset: unknown): asset is ServerAsset {
  return (
    typeof asset === 'object' &&
    asset !== null &&
    'os_type' in asset &&
    'cpu_model' in asset &&
    'is_virtual' in asset
  );
}

export function isMobileDeviceAsset(asset: unknown): asset is MobileDeviceAsset {
  return (
    typeof asset === 'object' &&
    asset !== null &&
    'os_type' in asset &&
    'model' in asset &&
    'is_supervised' in asset
  );
}

export function isPrinterAsset(asset: unknown): asset is PrinterAsset {
  return (
    typeof asset === 'object' &&
    asset !== null &&
    'model' in asset &&
    'is_network_printer' in asset &&
    'supports_color' in asset
  );
}

// Request interfaces
export interface CreateAssetRequest {
  /**
   * Built-in slugs: 'workstation' | 'network_device' | 'server' |
   * 'mobile_device' | 'printer' | 'unknown'. Any other value must match a
   * tenant asset_type_registry slug (custom type).
   */
  asset_type: string;
  client_id: string;
  asset_tag: string;
  name: string;
  status: string;
  /** Who owns the device. Defaults to 'client' server-side. */
  ownership?: 'client' | 'msp';
  location_id?: string | null;
  contact_name_id?: string | null;
  location?: string;
  serial_number?: string;
  purchase_date?: string;
  warranty_end_date?: string;
  manufacturer?: string | null;
  model?: string | null;
  vendor_id?: string | null;
  purchase_cost?: number | null;
  purchase_cost_currency?: string | null;
  order_number?: string | null;
  billing_profile_id?: string | null;
  workstation?: Omit<WorkstationAsset, 'tenant' | 'asset_id'>;
  network_device?: Omit<NetworkDeviceAsset, 'tenant' | 'asset_id'>;
  server?: Omit<ServerAsset, 'tenant' | 'asset_id'>;
  mobile_device?: Omit<MobileDeviceAsset, 'tenant' | 'asset_id'>;
  printer?: Omit<PrinterAsset, 'tenant' | 'asset_id'>;
  /** Custom-type schema fields plus integration namespaces (e.g. hudu_fields). */
  attributes?: Record<string, unknown>;
}

export type UpdateAssetRequest = Partial<CreateAssetRequest>;

export interface CreateAssetAssociationRequest {
  asset_id: string;
  entity_id: string;
  entity_type: 'ticket' | 'project';
  relationship_type: string;
}

export interface CreateAssetRelationshipRequest {
  parent_asset_id: string;
  child_asset_id: string;
  relationship_type: string;
}

export interface CreateAssetDocumentRequest {
  asset_id: string;
  document_id: string;
  notes?: string;
}

export interface CreateMaintenanceScheduleRequest {
  asset_id: string;
  schedule_name: string;
  description?: string;
  maintenance_type: MaintenanceType;
  frequency: MaintenanceFrequency;
  frequency_interval: number;
  schedule_config: Record<string, unknown>;
  next_maintenance: string;
}

export interface UpdateMaintenanceScheduleRequest extends Partial<CreateMaintenanceScheduleRequest> {
  is_active?: boolean;
}

export interface CreateMaintenanceHistoryRequest {
  asset_id: string;
  schedule_id: string;
  performed_at: string;
  notes?: string;
  maintenance_data: Record<string, unknown>;
}

export interface AssetQueryParams {
  client_id?: string;
  client_name?: string;
  location_id?: string;
  contact_name_id?: string;
  /** Built-in slug or tenant asset_type_registry slug (custom type). */
  asset_type?: string;
  status?: string;
  /** Filter by who owns the device. */
  ownership?: 'client' | 'msp';
  /** true: only assets with an open custody episode. false: only assets without one. */
  in_custody?: boolean;
  vendor_id?: string;
  group_id?: string;
  /** Only assets that are not in any group. */
  ungrouped_only?: boolean;
  search?: string;
  agent_status?: RmmAgentStatus;
  rmm_managed?: boolean;
  maintenance_status?: MaintenanceStatus;
  maintenance_type?: MaintenanceType;
  sort_by?: string;
  sort_direction?: 'asc' | 'desc';
  page?: number;
  limit?: number;
  include_extension_data?: boolean;
  include_client_details?: boolean;
}

export interface ClientSummary {
  total_clients: number;
  assets_by_client: Record<string, number>;
}

export interface AssetListResponse {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
  client_summary?: ClientSummary;
}

export interface AssetMaintenanceReport {
  asset_id: string;
  asset_name: string;
  total_schedules: number;
  active_schedules: number;
  completed_maintenances: number;
  upcoming_maintenances: number;
  last_maintenance?: string;
  next_maintenance?: string;
  compliance_rate: number;
  maintenance_history: AssetMaintenanceHistory[];
}

export interface ClientMaintenanceSummary {
  client_id: string;
  client_name: string;
  total_assets: number;
  assets_with_maintenance: number;
  total_schedules: number;
  overdue_maintenances: number;
  upcoming_maintenances: number;
  compliance_rate: number;
  maintenance_by_type: Record<string, number>;
}

// Asset type registry (custom asset types)
export type AssetTypeFieldKind = 'text' | 'number' | 'date' | 'select' | 'url' | 'boolean';

export interface AssetTypeField {
  key: string;
  label: string;
  kind: AssetTypeFieldKind;
  required?: boolean;
  options?: string[];
}

export interface AssetTypeRegistryEntry {
  tenant: string;
  type_id: string;
  slug: string;
  name: string;
  icon: string | null;
  fields_schema: AssetTypeField[];
  is_builtin: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
}

// Asset groups: bundles and shared workspaces
/**
 * A `bundle` travels and is assigned as one unit (one owner, no users); a
 * `shared_workspace` is a place plus the people who use it (users, no owner,
 * members carry no single assignee).
 */
export type AssetGroupKind = 'bundle' | 'shared_workspace';
export type AssetGroupContactRole = 'owner' | 'user';

export interface AssetGroup {
  tenant: string;
  group_id: string;
  client_id: string;
  name: string;
  kind: AssetGroupKind;
  location_id?: string | null;
  description?: string | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
  /** Joined on read. */
  client_name?: string | null;
  location_name?: string | null;
  member_count?: number;
  people_count?: number;
  members?: AssetGroupMember[];
  contacts?: AssetGroupContact[];
}

export interface AssetGroupMember {
  tenant: string;
  group_id: string;
  asset_id: string;
  added_at: string;
  added_by?: string | null;
  /** Joined on read. */
  asset_name?: string | null;
  asset_type?: string | null;
  asset_tag?: string | null;
  asset_status?: string | null;
}

export interface AssetGroupContact {
  tenant: string;
  group_id: string;
  contact_name_id: string;
  role: AssetGroupContactRole;
  added_at: string;
  /** Joined on read. */
  contact_name?: string | null;
  email?: string | null;
}

/** The group summary an asset read carries (FR-E12). */
export interface AssetGroupSummary {
  group_id: string;
  name: string;
  kind: AssetGroupKind;
  location_id?: string | null;
  location_name?: string | null;
  member_count?: number;
  user_count?: number;
}

// Assignment history
/**
 * Where an assignment came from. `manual` is a person in the MSP UI, `api` the
 * REST API, `rmm` auto-assignment from a signed-in user, `bundle` propagation
 * from a group, `import` the migration importer, `merge` a client merge and
 * `system` an automatic clear (client move, contact deletion).
 */
export type AssetAssignmentSource = 'manual' | 'api' | 'rmm' | 'bundle' | 'import' | 'merge' | 'system';

export interface AssetAssignment {
  tenant: string;
  assignment_id: string;
  asset_id: string;
  contact_name_id: string;
  assigned_at: string;
  assigned_by_user_id?: string | null;
  /** Null while the assignment is the current one. */
  unassigned_at?: string | null;
  unassigned_by_user_id?: string | null;
  source: AssetAssignmentSource;
  note?: string | null;
  /** Joined on read. */
  contact_name?: string | null;
  assigned_by_name?: string | null;
  unassigned_by_name?: string | null;
  asset_name?: string | null;
  asset_tag?: string | null;
  asset_type?: string | null;
  asset_status?: string | null;
}

// Asset status registry (tenant-managed lifecycle list)
/**
 * Lifecycle bucket a status belongs to. Metrics that mean "deployed" use
 * `deployable` rather than the literal `active` slug, so a tenant's custom
 * "In use" status counts too.
 */
export type AssetStatusKind = 'deployable' | 'pending' | 'undeployable' | 'archived';

export interface AssetStatus {
  tenant: string;
  status_id: string;
  /** What `assets.status` stores. */
  slug: string;
  label: string;
  kind: AssetStatusKind;
  is_builtin: boolean;
  is_active: boolean;
  display_order: number;
  created_at: string;
  updated_at: string;
  /** Assets currently on this status; only populated by the settings list. */
  in_use_count?: number;
}

export interface CreateAssetStatusInput {
  label: string;
  kind: AssetStatusKind;
  display_order?: number;
}

export interface UpdateAssetStatusInput {
  label?: string;
  kind?: AssetStatusKind;
  display_order?: number;
}

export interface CreateAssetTypeInput {
  name: string;
  icon?: string | null;
  fields_schema?: AssetTypeField[];
  display_order?: number;
}

export interface UpdateAssetTypeInput {
  name?: string;
  icon?: string | null;
  fields_schema?: AssetTypeField[];
  display_order?: number;
}
