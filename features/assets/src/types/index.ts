import { z } from 'zod';

/**
 * Asset Types
 */
export type AssetType = 'workstation' | 'network_device' | 'server' | 'mobile_device' | 'printer' | 'unknown';
export type AssetStatus = 'active' | 'inactive' | 'in_repair' | 'retired' | 'lost' | 'stolen';
export type MaintenanceFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'custom';
export type MaintenanceType = 'preventive' | 'inspection' | 'calibration' | 'replacement';

/**
 * Core Asset interface
 */
export interface Asset {
  asset_id: string;
  tenant: string;
  asset_tag: string;
  name: string;
  company_id: string;
  asset_type: AssetType;
  serial_number?: string;
  status: string;
  location?: string;
  purchase_date?: string;
  warranty_end_date?: string;
  created_at: string;
  updated_at: string;
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

/**
 * Asset Extension Types (for specific asset types)
 */
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

/**
 * Asset Relationship
 */
export interface AssetRelationship {
  tenant: string;
  parent_asset_id: string;
  child_asset_id: string;
  relationship_type: string;
  created_at: string;
  updated_at: string;
  name: string;
}

/**
 * Asset History
 */
export interface AssetHistory {
  tenant: string;
  history_id: string;
  asset_id: string;
  changed_by: string;
  change_type: string;
  changes: Record<string, unknown>;
  changed_at: string;
}

/**
 * Validation Schemas
 */

// Base asset schema
export const createAssetSchema = z.object({
  asset_type: z.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']),
  client_id: z.string().uuid(),
  asset_tag: z.string().min(1, 'Asset tag is required').max(255),
  name: z.string().min(1, 'Asset name is required').max(255),
  status: z.string().min(1, 'Status is required'),
  location: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().datetime().optional(),
  warranty_end_date: z.string().datetime().optional(),
  // Extension data for specific asset types
  workstation: z.object({
    os_type: z.string(),
    os_version: z.string(),
    cpu_model: z.string(),
    cpu_cores: z.number().min(1),
    ram_gb: z.number().min(0),
    storage_type: z.string(),
    storage_capacity_gb: z.number().min(0),
    gpu_model: z.string().optional(),
    last_login: z.string().datetime().optional(),
    installed_software: z.array(z.unknown()).default([]),
  }).optional(),
  network_device: z.object({
    device_type: z.enum(['switch', 'router', 'firewall', 'access_point', 'load_balancer']),
    management_ip: z.string(),
    port_count: z.number().min(0),
    firmware_version: z.string(),
    supports_poe: z.boolean(),
    power_draw_watts: z.number().min(0),
    vlan_config: z.record(z.unknown()).default({}),
    port_config: z.record(z.unknown()).default({}),
  }).optional(),
  server: z.object({
    os_type: z.string(),
    os_version: z.string(),
    cpu_model: z.string(),
    cpu_cores: z.number().min(1),
    ram_gb: z.number().min(0),
    storage_config: z.array(z.unknown()).default([]),
    raid_config: z.string().optional(),
    is_virtual: z.boolean(),
    hypervisor: z.string().optional(),
    network_interfaces: z.array(z.unknown()).default([]),
    primary_ip: z.string().optional(),
    installed_services: z.array(z.unknown()).default([]),
  }).optional(),
  mobile_device: z.object({
    os_type: z.string(),
    os_version: z.string(),
    model: z.string(),
    imei: z.string().optional(),
    phone_number: z.string().optional(),
    carrier: z.string().optional(),
    last_check_in: z.string().datetime().optional(),
    is_supervised: z.boolean(),
    installed_apps: z.array(z.unknown()).default([]),
  }).optional(),
  printer: z.object({
    model: z.string(),
    ip_address: z.string().optional(),
    is_network_printer: z.boolean(),
    supports_color: z.boolean(),
    supports_duplex: z.boolean(),
    max_paper_size: z.number().optional(),
    supported_paper_types: z.array(z.unknown()).default([]),
    monthly_duty_cycle: z.number().optional(),
    supply_levels: z.record(z.unknown()).default({}),
  }).optional(),
});

export type CreateAssetInput = z.infer<typeof createAssetSchema>;

// Update asset schema
export const updateAssetSchema = createAssetSchema.partial();

export type UpdateAssetInput = z.infer<typeof updateAssetSchema>;

// Asset relationship schema
export const createAssetRelationshipSchema = z.object({
  parent_asset_id: z.string().uuid(),
  child_asset_id: z.string().uuid(),
  relationship_type: z.string().min(1),
});

export type CreateAssetRelationshipInput = z.infer<typeof createAssetRelationshipSchema>;

/**
 * Asset Filters
 */
export interface AssetFilters {
  search?: string;
  client_id?: string;
  asset_type?: AssetType;
  status?: string;
  location?: string;
  page?: number;
  limit?: number;
  orderBy?: keyof Asset;
  orderDirection?: 'asc' | 'desc';
  include_extension_data?: boolean;
}

/**
 * Paginated Response
 */
export interface AssetListResponse {
  assets: Asset[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Maintenance Types
 */
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

export const createMaintenanceScheduleSchema = z.object({
  asset_id: z.string().uuid(),
  schedule_name: z.string().min(1),
  description: z.string().optional(),
  maintenance_type: z.enum(['preventive', 'inspection', 'calibration', 'replacement']),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  frequency_interval: z.number().min(1),
  schedule_config: z.record(z.unknown()).default({}),
  next_maintenance: z.string().datetime(),
});

export type CreateMaintenanceScheduleInput = z.infer<typeof createMaintenanceScheduleSchema>;

export const updateMaintenanceScheduleSchema = createMaintenanceScheduleSchema.partial();

export type UpdateMaintenanceScheduleInput = z.infer<typeof updateMaintenanceScheduleSchema>;

export const recordMaintenanceSchema = z.object({
  asset_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  performed_at: z.string().datetime(),
  notes: z.string().optional(),
  maintenance_data: z.record(z.unknown()).default({}),
});

export type RecordMaintenanceInput = z.infer<typeof recordMaintenanceSchema>;
