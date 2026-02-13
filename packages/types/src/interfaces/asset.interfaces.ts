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
export type RmmProvider = 'ninjaone' | 'datto' | 'connectwise_automate';
export type RmmAgentStatus = 'online' | 'offline' | 'unknown';

export interface Asset {
  asset_id: string;
  asset_type: 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer' | 'unknown';
  client_id: string;
  asset_tag: string;
  serial_number?: string;
  name: string;
  status: string;
  location?: string;
  purchase_date?: string;
  warranty_end_date?: string;
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
  cpu_cores: number;
  ram_gb: number;
  storage_type: string;
  storage_capacity_gb: number;
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
  port_count: number;
  firmware_version: string;
  supports_poe: boolean;
  power_draw_watts: number;
  vlan_config: Record<string, unknown>;
  port_config: Record<string, unknown>;
}

export interface ServerAsset {
  tenant: string;
  asset_id: string;
  os_type: string;
  os_version: string;
  cpu_model: string;
  cpu_cores: number;
  ram_gb: number;
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
  free_gb: number;
  utilization_percent: number;
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
  max_paper_size?: number;
  supported_paper_types: unknown[];
  monthly_duty_cycle?: number;
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
export type MaintenanceType = 'preventive' | 'inspection' | 'calibration' | 'replacement';
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
}

export interface AssetMaintenanceHistory {
  tenant: string;
  history_id: string;
  asset_id: string;
  schedule_id: string;
  performed_at: string;
  performed_by: string;
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
  asset_type: 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer' | 'unknown';
  client_id: string;
  asset_tag: string;
  name: string;
  status: string;
  location?: string;
  serial_number?: string;
  purchase_date?: string;
  warranty_end_date?: string;
  workstation?: Omit<WorkstationAsset, 'tenant' | 'asset_id'>;
  network_device?: Omit<NetworkDeviceAsset, 'tenant' | 'asset_id'>;
  server?: Omit<ServerAsset, 'tenant' | 'asset_id'>;
  mobile_device?: Omit<MobileDeviceAsset, 'tenant' | 'asset_id'>;
  printer?: Omit<PrinterAsset, 'tenant' | 'asset_id'>;
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
  asset_type?: 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer' | 'unknown';
  status?: string;
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
