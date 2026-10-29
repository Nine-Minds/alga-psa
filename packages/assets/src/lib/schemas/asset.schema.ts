import { z } from 'zod';
import { parseCustomRecurrence } from '../maintenanceRecurrence';

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

// alga0002283: every extension numeric column is nullable in the database and
// "empty" means "unknown", not 0 — so the schemas accept and the types carry
// `number | null` end to end.
const workstationAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  os_type: z.string(),
  os_version: z.string(),
  cpu_model: z.string(),
  cpu_cores: z.number().nullable(),
  ram_gb: z.number().nullable(),
  storage_type: z.string(),
  storage_capacity_gb: z.number().nullable(),
  gpu_model: z.string().optional(),
  last_login: z.string().optional(),
  installed_software: z.array(z.unknown())
});

const network_device_asset_schema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  device_type: z.enum(['switch', 'router', 'firewall', 'access_point', 'load_balancer']),
  management_ip: z.string(),
  port_count: z.number().nullable(),
  firmware_version: z.string(),
  supports_poe: z.boolean(),
  power_draw_watts: z.number().nullable(),
  vlan_config: z.record(z.unknown()),
  port_config: z.record(z.unknown())
});

const serverAssetSchema = z.object({
  tenant: z.string().uuid(),
  asset_id: z.string().uuid(),
  os_type: z.string(),
  os_version: z.string(),
  cpu_model: z.string(),
  cpu_cores: z.number().nullable(),
  ram_gb: z.number().nullable(),
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
  max_paper_size: z.number().nullable().optional(),
  supported_paper_types: z.array(z.unknown()),
  monthly_duty_cycle: z.number().nullable().optional(),
  supply_levels: z.record(z.unknown())
});

const assetGroupSummarySchema = z.object({
  group_id: z.string().uuid(),
  name: z.string(),
  kind: z.enum(['bundle', 'shared_workspace']),
  location_id: z.string().uuid().nullable().optional(),
  location_name: z.string().nullable().optional(),
  member_count: z.number().optional(),
  user_count: z.number().optional(),
});

export const assetSchema = z.object({
  asset_id: z.string().uuid(),
  // Built-in slug or tenant asset_type_registry slug (custom types).
  asset_type: z.string().min(1),
  client_id: z.string().uuid(),
  asset_tag: z.string(),
  serial_number: z.string().optional(),
  name: z.string(),
  status: z.string(),
  location_id: z.string().uuid().nullable().optional(),
  // Client contact the device is assigned to (portal contact-scoped visibility).
  contact_name_id: z.string().uuid().nullable().optional(),
  contact_name: z.string().nullable().optional(),
  // The group this asset belongs to, when it has one (FR-E12).
  group: assetGroupSummarySchema.nullable().optional(),
  location: z.string().optional(),
  purchase_date: z.string().optional(),
  warranty_end_date: z.string().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  // Minor units (cents); pg returns bigint as a string, so coerce.
  purchase_cost: z.coerce.number().int().nullable().optional(),
  purchase_cost_currency: z.string().nullable().optional(),
  order_number: z.string().nullable().optional(),
  billing_profile_id: z.string().uuid().nullable().optional(),
  billing_profile_name: z.string().nullable().optional(),
  created_at: z.string(),
  updated_at: z.string(),
  tenant: z.string().uuid(),
  attributes: z.record(z.unknown()).nullable().optional(),
  client: assetClientInfoSchema.optional(),
  relationships: z.array(assetRelationshipSchema).optional(),
  workstation: workstationAssetSchema.optional(),
  network_device: network_device_asset_schema.optional(),
  server: serverAssetSchema.optional(),
  mobile_device: mobileDeviceAssetSchema.optional(),
  printer: printerAssetSchema.optional()
});

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

const maintenanceFrequencySchema = z.enum([
  'daily',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom'
]);

// Mirrors the asset_maintenance_schedules / _history CHECK constraints, widened
// to include 'corrective' by migration 20260728100000.
const maintenanceTypeSchema = z.enum([
  'preventive',
  'corrective',
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
  performed_by_name: z.string().optional(),
  notes: z.string().optional(),
  maintenance_data: z.record(z.unknown()),
  created_at: z.string()
});

export const createAssetSchema = z.object({
  // Built-in slug or tenant asset_type_registry slug; registry membership is
  // enforced in the action layer (typed 'invalid_asset_type' error).
  asset_type: z.string().min(1),
  client_id: z.string().uuid(),
  asset_tag: z.string(),
  name: z.string(),
  status: z.string(),
  ownership: z.enum(['client', 'msp']).optional(),
  location_id: z.string().uuid().nullable().optional(),
  // Client contact the device is assigned to (portal contact-scoped visibility).
  contact_name_id: z.string().uuid().nullable().optional(),
  location: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: z.string().optional(),
  warranty_end_date: z.string().optional(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  vendor_id: z.string().uuid().nullable().optional(),
  purchase_cost: z.coerce.number().int().nullable().optional(),
  purchase_cost_currency: z.string().min(3).max(3).nullable().optional(),
  order_number: z.string().nullable().optional(),
  billing_profile_id: z.string().uuid().nullable().optional(),
  workstation: workstationAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  network_device: network_device_asset_schema.omit({ tenant: true, asset_id: true }).optional(),
  server: serverAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  mobile_device: mobileDeviceAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  printer: printerAssetSchema.omit({ tenant: true, asset_id: true }).optional(),
  attributes: z.record(z.unknown()).optional()
});

export const updateAssetSchema = createAssetSchema
  .extend({
    workstation: workstationAssetSchema.omit({ tenant: true, asset_id: true }).partial().optional(),
    network_device: network_device_asset_schema.omit({ tenant: true, asset_id: true }).partial().optional(),
    server: serverAssetSchema.omit({ tenant: true, asset_id: true }).partial().optional(),
    mobile_device: mobileDeviceAssetSchema.omit({ tenant: true, asset_id: true }).partial().optional(),
    printer: printerAssetSchema.omit({ tenant: true, asset_id: true }).partial().optional()
  })
  .partial();

export const createAssetAssociationSchema = z.object({
  asset_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  entity_type: z.enum(['ticket', 'project']),
  relationship_type: z.string()
});

const maintenanceScheduleWriteSchema = z.object({
  asset_id: z.string().uuid(),
  schedule_name: z.string(),
  description: z.string().optional(),
  maintenance_type: maintenanceTypeSchema,
  frequency: maintenanceFrequencySchema,
  frequency_interval: z.number(),
  schedule_config: z.record(z.unknown()),
  next_maintenance: z.string()
});

// `custom` needs a rule in schedule_config.recurrence. Partial updates that
// send only one of the two fields are re-checked against the stored row.
const requireCustomRecurrence = (
  data: { frequency?: string; schedule_config?: Record<string, unknown> },
  ctx: z.RefinementCtx
): void => {
  if (data.frequency !== 'custom' || data.schedule_config === undefined) return;
  try {
    parseCustomRecurrence(data.schedule_config);
  } catch (error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['schedule_config', 'recurrence'], message: (error as Error).message });
  }
};

export const createMaintenanceScheduleSchema = maintenanceScheduleWriteSchema.superRefine(requireCustomRecurrence);

export const updateMaintenanceScheduleSchema = maintenanceScheduleWriteSchema.partial().extend({
  is_active: z.boolean().optional()
}).superRefine(requireCustomRecurrence);

export const createMaintenanceHistorySchema = z.object({
  asset_id: z.string().uuid(),
  schedule_id: z.string().uuid(),
  performed_at: z.string(),
  performed_by: z.string().uuid(),
  notes: z.string().optional(),
  maintenance_data: z.record(z.unknown())
});

export const updateMaintenanceHistorySchema = createMaintenanceHistorySchema.partial();

export const assetQuerySchema = z.object({
  client_id: z.string().uuid().optional(),
  location_id: z.string().uuid().optional(),
  contact_name_id: z.string().uuid().optional(),
  asset_type: z.string().optional(),
  status: z.string().optional(),
  ownership: z.enum(['client', 'msp']).optional(),
  in_custody: z.boolean().optional(),
  vendor_id: z.string().uuid().optional(),
  group_id: z.string().uuid().optional(),
  /** Only assets that are not in any group (the group drawer's Add assets). */
  ungrouped_only: z.boolean().optional(),
  page: z.number().int().positive().optional(),
  pageSize: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional(),
  search: z.string().optional(),
  agent_status: z.string().optional(),
  rmm_managed: z.boolean().optional(),
  sort_by: z.string().optional(),
  sort_direction: z.enum(['asc', 'desc']).optional(),
  include_extension_data: z.boolean().optional()
});

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
  overdue_maintenance: z.number().optional(),
  total_schedules: z.number(),
  overdue_maintenances: z.number(),
  upcoming_maintenances: z.number(),
  compliance_rate: z.number(),
  maintenance_by_type: z.record(z.number())
});
