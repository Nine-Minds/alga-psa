import { z } from 'zod';

// Base schemas
const assetClientInfoSchema = z.object({
  client_id: z.string().uuid(),
  client_name: z.string()
});

export const assetRelationshipSchema = z.object({
  tenant: z.string().uuid(),
  parent_asset_id: z.string().uuid(),
  child_asset_id: z.string().uuid(),
  relationship_type: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  name: z.string()
});

export const createAssetRelationshipSchema = z.object({
  parent_asset_id: z.string().uuid(),
  child_asset_id: z.string().uuid(),
  relationship_type: z.string().min(1)
});

// Extension table schemas
const workstationAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  os_type: z.string(),
  os_version: z.string(),
  cpu_model: z.string(),
  cpu_cores: z.number(),
  ram_gb: z.number(),
  storage_type: z.string(),
  storage_capacity_gb: z.number(),
  gpu_model: z.string().optional(),
  last_login: z.string().optional(),
  installed_software: z.array(z.unknown())
});

const network_device_asset_schema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  device_type: z.enum(['switch', 'router', 'firewall', 'access_point', 'load_balancer']),
  management_ip: z.string(),
  port_count: z.number(),
  firmware_version: z.string(),
  supports_poe: z.boolean(),
  power_draw_watts: z.number(),
  vlan_config: z.record(z.unknown()),
  port_config: z.record(z.unknown())
});

const serverAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  os_type: z.string(),
  os_version: z.string(),
  cpu_model: z.string(),
  cpu_cores: z.number(),
  ram_gb: z.number(),
  storage_config: z.array(z.unknown()),
  raid_config: z.string().optional(),
  is_virtual: z.boolean(),
  hypervisor: z.string().optional(),
  network_interfaces: z.array(z.unknown()),
  primary_ip: z.string().optional(),
  installed_services: z.array(z.unknown())
});

const mobileDeviceAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  os_type: z.string(),
  os_version: z.string(),
  model: z.string(),
  imei: z.string().optional(),
  phone_number: z.string().optional(),
  carrier: z.string().optional(),
  last_check_in: z.string().optional(),
  is_supervised: z.boolean(),
  installed_apps: z.array(z.unknown())
});

const printerAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  model: z.string(),
  ip_address: z.string().optional(),
  is_network_printer: z.boolean(),
  supports_color: z.boolean(),
  supports_duplex: z.boolean(),
  max_paper_size: z.number().optional(),
  supported_paper_types: z.array(z.unknown()),
  monthly_duty_cycle: z.number().optional(),
  supply_levels: z.record(z.unknown())
});

// Asset schemas
export const assetSchema = z.object({
  asset_id: z.string().uuid(),
  asset_type: z.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']),
  client_id: z.string().uuid(),
  asset_tag: z.string(),
  serial_number: z.string().optional(),
  name: z.string(),
  status: z.string(),
  location: z.string().optional(),
  purchase_date: z.string().optional(),
  warranty_end_date: z.string().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  tenant: z.string().uuid(),
  client: assetClientInfoSchema.optional(),
  relationships: z.array(assetRelationshipSchema).optional(),
  workstation: workstationAssetSchema.optional(),
  network_device: network_device_asset_schema.optional(),
  server: serverAssetSchema.optional(),
  mobile_device: mobileDeviceAssetSchema.optional(),
  printer: printerAssetSchema.optional()
});

// Asset association schemas
export const assetAssociationSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  entity_type: z.enum(['ticket', 'project']),
  relationship_type: z.string(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  asset: assetSchema.optional()
});

// Document schemas
export const assetDocumentSchema = z.object({
  tenant: z.string().uuid(),
  association_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  document_id: z.string().uuid(),
  notes: z.string().optional(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  document_name: z.string(),
  mime_type: z.string(),
  file_size: z.number()
});

// Maintenance schemas
const maintenanceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom'
]);

const maintenanceTypeSchema = z.enum([
  'preventive',
  'inspection',
  'calibration',
  'replacement'
]);

export const assetMaintenanceScheduleSchema = z.object({
  tenant: z.string().uuid(),
  schedule_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  schedule_name: z.string(),
  description: z.string().optional(),
  maintenance_type: maintenanceTypeSchema,
  frequency: maintenanceFrequencySchema,
  frequency_interval: z.number(),
  schedule_config: z.record(z.unknown()),
  next_maintenance: z.string(),
  last_maintenance: z.string().optional(),
  is_active: z.boolean(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string()
});

export const assetMaintenanceHistorySchema = z.object({
  tenant: z.string().uuid(),
  history_id: z.string().uuid(),
  asset_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  performed_at: z.string(),
  performed_by: z.string().uuid(),
  notes: z.string().optional(),
  maintenance_data: z.record(z.unknown()),
  created_at: z.string()
});

// Request schemas
export const createAssetSchema = z.object({
  asset_type: z.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']),
  client_id: z.string().uuid(),
  asset_tag: z.string(),
  name: z.string(),
  status: z.string(),
  location: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  warranty_end_date: z.string().optional(),
  workstation: workstationAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  network_device: network_device_asset_schema.omit({ tenant: true, asset_id: true }).optional(),
  server: serverAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  mobile_device: mobileDeviceAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  printer: printerAssetSchema.omit({ tenant: true, asset_id: true }).optional()
});

export const updateAssetSchema = createAssetSchema.partial();

export const createAssetAssociationSchema = z.object({
  asset_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  entity_type: z.enum(['ticket', 'project']),
  relationship_type: z.string()
});

export const createMaintenanceScheduleSchema = z.object({
  asset_id: z.string().uuid(),
  schedule_name: z.string(),
  description: z.string().optional(),
  maintenance_type: maintenanceTypeSchema,
  frequency: maintenanceFrequencySchema,
  frequency_interval: z.number(),
  schedule_config: z.record(z.unknown()),
  next_maintenance: z.string()
});

export const updateMaintenanceScheduleSchema = createMaintenanceScheduleSchema.partial().extend({
  is_active: z.boolean().optional()
});

export const createMaintenanceHistorySchema = z.object({
  asset_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  performed_at: z.string(),
  notes: z.string().optional(),
  maintenance_data: z.record(z.unknown())
});

export const assetQuerySchema = z.object({
  client_id: z.string().uuid().optional(),
  client_name: z.string().optional(),
  asset_type: z.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']).optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  agent_status: z.enum(['online', 'offline', 'unknown']).optional(),
  rmm_managed: z.boolean().optional(),
  maintenance_status: z.enum(['due', 'overdue', 'upcoming', 'completed']).optional(),
  maintenance_type: maintenanceTypeSchema.optional(),
  page: z.number().optional(),
  limit: z.number().optional(),
  include_extension_data: z.boolean().optional(),
  include_client_details: z.boolean().optional()
});

// Report schemas
export const assetMaintenanceReportSchema = z.object({
  asset_id: z.string().uuid(),
  asset_name: z.string(),
  total_schedules: z.number(),
  active_schedules: z.number(),
  completed_maintenances: z.number(),
  upcoming_maintenances: z.number(),
  last_maintenance: z.string().optional(),
  next_maintenance: z.string().optional(),
  compliance_rate: z.number(),
  maintenance_history: z.array(assetMaintenanceHistorySchema)
});

export const clientMaintenanceSummarySchema = z.object({
  client_id: z.string().uuid(),
  client_name: z.string(),
  total_assets: z.number(),
  assets_with_maintenance: z.number(),
  total_schedules: z.number(),
  overdue_maintenances: z.number(),
  upcoming_maintenances: z.number(),
  compliance_rate: z.number(),
  maintenance_by_type: z.record(z.number())
});
