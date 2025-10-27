/**
 * Asset API Schemas
 * Validation schemas for asset-related API endpoints
 */

import { z } from 'zod';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema
} from './common';

// Asset type schema
export const assetTypeSchema = z.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']);

// Base asset schema
export const createAssetSchema = z.object({
  client_id: uuidSchema,
  asset_type: assetTypeSchema,
  asset_tag: z.string().min(1, 'Asset tag is required').max(255),
  name: z.string().min(1, 'Asset name is required').max(255),
  status: z.string().min(1, 'Status is required'),
  location: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: dateSchema.optional(),
  warranty_end_date: dateSchema.optional()
});

// Update asset schema (all fields optional)
export const updateAssetSchema = createUpdateSchema(createAssetSchema);

// Asset extension schemas for different types
export const workstationAssetSchema = z.object({
  os_type: z.string().optional(),
  os_version: z.string().optional(),
  cpu_model: z.string().optional(),
  cpu_cores: z.number().min(1).optional(),
  ram_gb: z.number().min(0).optional(),
  storage_type: z.string().optional(),
  storage_capacity_gb: z.number().min(0).optional(),
  gpu_model: z.string().optional(),
  installed_software: z.array(z.string()).optional(),
  last_login: z.string().datetime().optional()
});

export const networkDeviceAssetSchema = z.object({
  device_type: z.enum(['switch', 'router', 'firewall', 'access_point', 'load_balancer']).optional(),
  management_ip: z.string().ip().optional(),
  port_count: z.number().min(0).optional(),
  firmware_version: z.string().optional(),
  supports_poe: z.boolean().optional(),
  power_draw_watts: z.number().min(0).optional(),
  vlan_config: z.record(z.any()).optional(),
  port_config: z.record(z.any()).optional()
});

export const serverAssetSchema = z.object({
  os_type: z.string().optional(),
  os_version: z.string().optional(),
  cpu_model: z.string().optional(),
  cpu_cores: z.number().min(1).optional(),
  ram_gb: z.number().min(0).optional(),
  storage_config: z.array(z.record(z.any())).optional(),
  raid_config: z.string().optional(),
  is_virtual: z.boolean().optional(),
  hypervisor: z.string().optional(),
  network_interfaces: z.array(z.record(z.any())).optional(),
  primary_ip: z.string().ip().optional(),
  installed_services: z.array(z.string()).optional()
});

export const mobileDeviceAssetSchema = z.object({
  os_type: z.string().optional(),
  os_version: z.string().optional(),
  model: z.string().optional(),
  imei: z.string().optional(),
  phone_number: z.string().optional(),
  carrier: z.string().optional(),
  is_supervised: z.boolean().optional(),
  last_check_in: z.string().datetime().optional(),
  installed_apps: z.array(z.string()).optional()
});

export const printerAssetSchema = z.object({
  model: z.string().optional(),
  ip_address: z.string().ip().optional(),
  is_network_printer: z.boolean().optional(),
  supports_color: z.boolean().optional(),
  supports_duplex: z.boolean().optional(),
  max_paper_size: z.string().optional(),
  supported_paper_types: z.array(z.string()).optional(),
  monthly_duty_cycle: z.number().min(0).optional(),
  supply_levels: z.record(z.number()).optional()
});

// Combined asset creation schema with extension data
export const createAssetWithExtensionSchema = createAssetSchema.extend({
  extension_data: z.union([
    workstationAssetSchema,
    networkDeviceAssetSchema,
    serverAssetSchema,
    mobileDeviceAssetSchema,
    printerAssetSchema
  ]).optional()
});

// Asset filter schema
export const assetFilterSchema = baseFilterSchema.extend({
  asset_tag: z.string().optional(),
  name: z.string().optional(),
  client_id: uuidSchema.optional(),
  asset_type: assetTypeSchema.optional(),
  status: z.string().optional(),
  location: z.string().optional(),
  client_name: z.string().optional(),
  has_warranty: booleanTransform.optional(),
  warranty_expired: booleanTransform.optional(),
  maintenance_due: booleanTransform.optional(),
  purchase_date_from: dateSchema.optional(),
  purchase_date_to: dateSchema.optional(),
  warranty_end_from: dateSchema.optional(),
  warranty_end_to: dateSchema.optional()
});

// Asset list query schema
export const assetListQuerySchema = createListQuerySchema(assetFilterSchema);

// Asset response schema
export const assetResponseSchema = z.object({
  asset_id: uuidSchema,
  client_id: uuidSchema,
  asset_type: assetTypeSchema,
  asset_tag: z.string(),
  name: z.string(),
  status: z.string(),
  location: z.string().nullable(),
  serial_number: z.string().nullable(),
  purchase_date: dateSchema.nullable(),
  warranty_end_date: dateSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Computed/joined fields
  client_name: z.string().optional(),
  warranty_status: z.string().optional(),
  maintenance_status: z.string().optional()
});

// Asset with details response schema (includes extension data)
export const assetWithDetailsResponseSchema = assetResponseSchema.extend({
  client: z.object({
    client_id: uuidSchema,
    client_name: z.string(),
    email: z.string().nullable(),
    phone_no: z.string().nullable()
  }).optional(),
  
  extension_data: z.union([
    workstationAssetSchema,
    networkDeviceAssetSchema,
    serverAssetSchema,
    mobileDeviceAssetSchema,
    printerAssetSchema
  ]).optional(),
  
  relationships: z.array(z.object({
    relationship_id: uuidSchema,
    related_asset_id: uuidSchema,
    relationship_type: z.string(),
    related_asset_name: z.string(),
    related_asset_tag: z.string()
  })).optional(),
  
  documents: z.array(z.object({
    document_id: uuidSchema,
    original_filename: z.string(),
    file_size: z.number(),
    mime_type: z.string(),
    uploaded_at: z.string().datetime(),
    notes: z.string().nullable()
  })).optional(),
  
  maintenance_schedules: z.array(z.object({
    schedule_id: uuidSchema,
    schedule_type: z.string(),
    frequency: z.string(),
    next_maintenance: dateSchema.nullable(),
    is_active: z.boolean()
  })).optional()
});

// Asset relationship schemas
export const createAssetRelationshipSchema = z.object({
  related_asset_id: uuidSchema,
  relationship_type: z.string().min(1, 'Relationship type is required')
});

export const assetRelationshipResponseSchema = z.object({
  relationship_id: uuidSchema,
  asset_id: uuidSchema,
  related_asset_id: uuidSchema,
  relationship_type: z.string(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Related asset details
  related_asset: z.object({
    asset_id: uuidSchema,
    asset_tag: z.string(),
    name: z.string(),
    asset_type: assetTypeSchema,
    status: z.string()
  }).optional()
});

// Asset document association schemas
export const createAssetDocumentSchema = z.object({
  document_id: uuidSchema,
  notes: z.string().optional()
});

export const assetDocumentResponseSchema = z.object({
  association_id: uuidSchema,
  asset_id: uuidSchema,
  document_id: uuidSchema,
  notes: z.string().nullable(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Document details
  document: z.object({
    document_id: uuidSchema,
    original_filename: z.string(),
    file_size: z.number(),
    mime_type: z.string(),
    uploaded_at: z.string().datetime()
  }).optional()
});

// Asset maintenance schemas
export const createMaintenanceScheduleSchema = z.object({
  schedule_type: z.enum(['preventive', 'inspection', 'calibration', 'replacement']),
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  frequency_interval: z.number().min(1).optional(),
  start_date: dateSchema,
  end_date: dateSchema.optional(),
  notes: z.string().optional(),
  assigned_to: uuidSchema.optional(),
  is_active: z.boolean().optional().default(true),
  schedule_config: z.record(z.any()).optional()
});

export const updateMaintenanceScheduleSchema = createUpdateSchema(createMaintenanceScheduleSchema);

export const maintenanceScheduleResponseSchema = z.object({
  schedule_id: uuidSchema,
  asset_id: uuidSchema,
  schedule_type: z.string(),
  frequency: z.string(),
  frequency_interval: z.number().nullable(),
  start_date: dateSchema,
  end_date: dateSchema.nullable(),
  last_maintenance: dateSchema.nullable(),
  next_maintenance: dateSchema.nullable(),
  notes: z.string().nullable(),
  assigned_to: uuidSchema.nullable(),
  is_active: z.boolean(),
  schedule_config: z.record(z.any()).nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Assigned user details
  assigned_user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional()
});

export const recordMaintenanceSchema = z.object({
  schedule_id: uuidSchema.optional(),
  maintenance_type: z.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']),
  performed_by: uuidSchema,
  performed_at: z.string().datetime(),
  duration_hours: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  notes: z.string().optional(),
  parts_used: z.array(z.string()).optional(),
  maintenance_data: z.record(z.any()).optional()
});

export const maintenanceHistoryResponseSchema = z.object({
  history_id: uuidSchema,
  asset_id: uuidSchema,
  schedule_id: uuidSchema.nullable(),
  maintenance_type: z.string(),
  performed_by: uuidSchema,
  performed_at: z.string().datetime(),
  duration_hours: z.number().nullable(),
  cost: z.number().nullable(),
  notes: z.string().nullable(),
  parts_used: z.array(z.string()).nullable(),
  maintenance_data: z.record(z.any()).nullable(),
  created_at: z.string().datetime(),
  tenant: uuidSchema,
  
  // Performed by user details
  performed_by_user: z.object({
    user_id: uuidSchema,
    first_name: z.string(),
    last_name: z.string(),
    email: z.string()
  }).optional()
});

// Bulk operations schemas
export const bulkUpdateAssetSchema = z.object({
  assets: z.array(z.object({
    asset_id: uuidSchema,
    data: updateAssetSchema
  })).min(1).max(50)
});

export const bulkAssetStatusSchema = z.object({
  asset_ids: z.array(uuidSchema).min(1).max(50),
  status: z.string().min(1, 'Status is required')
});

// Asset statistics schema
export const assetStatsResponseSchema = z.object({
  total_assets: z.number(),
  assets_by_type: z.record(z.number()),
  assets_by_status: z.record(z.number()),
  assets_by_client: z.record(z.number()),
  warranty_expiring_soon: z.number(),
  warranty_expired: z.number(),
  maintenance_due: z.number(),
  maintenance_overdue: z.number(),
  average_asset_age_days: z.number().nullable(),
  total_asset_value: z.number(),
  assets_added_this_month: z.number()
});

// Asset search schema
export const assetSearchSchema = z.object({
  query: z.string().min(1, 'Search query is required'),
  fields: z.array(z.enum(['asset_tag', 'name', 'serial_number', 'location', 'client_name'])).optional(),
  asset_types: z.array(assetTypeSchema).optional(),
  statuses: z.array(z.string()).optional(),
  client_ids: z.array(uuidSchema).optional(),
  include_extension_data: booleanTransform.optional().default('false'),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).optional().default('25')
});

// Asset export schema
export const assetExportQuerySchema = z.object({
  format: z.enum(['csv', 'json', 'xlsx']).optional().default('csv'),
  include_extension_data: booleanTransform.optional().default('false'),
  include_maintenance: booleanTransform.optional().default('false'),
  include_documents: booleanTransform.optional().default('false'),
  asset_types: z.array(assetTypeSchema).optional(),
  statuses: z.array(z.string()).optional(),
  client_ids: z.array(uuidSchema).optional(),
  fields: z.array(z.string()).optional()
});

// Export types for TypeScript
export type CreateAssetData = z.infer<typeof createAssetSchema>;
export type CreateAssetWithExtensionData = z.infer<typeof createAssetWithExtensionSchema>;
export type UpdateAssetData = z.infer<typeof updateAssetSchema>;
export type AssetFilterData = z.infer<typeof assetFilterSchema>;
export type AssetResponse = z.infer<typeof assetResponseSchema>;
export type AssetWithDetailsResponse = z.infer<typeof assetWithDetailsResponseSchema>;
export type CreateAssetRelationshipData = z.infer<typeof createAssetRelationshipSchema>;
export type AssetRelationshipResponse = z.infer<typeof assetRelationshipResponseSchema>;
export type CreateAssetDocumentData = z.infer<typeof createAssetDocumentSchema>;
export type AssetDocumentResponse = z.infer<typeof assetDocumentResponseSchema>;
export type CreateMaintenanceScheduleData = z.infer<typeof createMaintenanceScheduleSchema>;
export type UpdateMaintenanceScheduleData = z.infer<typeof updateMaintenanceScheduleSchema>;
export type MaintenanceScheduleResponse = z.infer<typeof maintenanceScheduleResponseSchema>;
export type RecordMaintenanceData = z.infer<typeof recordMaintenanceSchema>;
export type MaintenanceHistoryResponse = z.infer<typeof maintenanceHistoryResponseSchema>;
export type AssetSearchData = z.infer<typeof assetSearchSchema>;
export type AssetExportQuery = z.infer<typeof assetExportQuerySchema>;
export type WorkstationAssetData = z.infer<typeof workstationAssetSchema>;
export type NetworkDeviceAssetData = z.infer<typeof networkDeviceAssetSchema>;
export type ServerAssetData = z.infer<typeof serverAssetSchema>;
export type MobileDeviceAssetData = z.infer<typeof mobileDeviceAssetSchema>;
export type PrinterAssetData = z.infer<typeof printerAssetSchema>;