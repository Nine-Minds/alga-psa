// Asset interfaces
export interface AssetHistory {
  tenant: string;
  history_id: string;
  asset_id: string;
  changed_by: string;
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
  maintenance_status?: MaintenanceStatus;
  maintenance_type?: MaintenanceType;
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
  maintenance_history: unknown[];
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
