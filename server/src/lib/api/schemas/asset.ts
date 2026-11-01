/**
 * Asset API Schemas
 * Validation schemas for asset-related API endpoints
 */

import { z } from 'zod';
import { parseCustomRecurrence } from '@alga-psa/assets/lib/maintenanceRecurrence';
import { 
  uuidSchema, 
  createListQuerySchema, 
  createUpdateSchema,
  baseFilterSchema,
  booleanTransform,
  dateSchema
} from './common';
import { partialWithoutDefaults } from '@alga-psa/validation/lib/partialWithoutDefaults';

// Asset type schema — any registry slug (built-in or custom tenant type), not a
// fixed enum. Validation against the tenant's asset_type_registry happens in
// the shared asset attribute write layer.
export const assetTypeSchema = z.string().min(1, 'Asset type is required').max(255);

// Base asset schema
export const createAssetSchema = z.object({
  client_id: uuidSchema,
  asset_type: assetTypeSchema,
  asset_tag: z.string().min(1, 'Asset tag is required').max(255),
  name: z.string().min(1, 'Asset name is required').max(255),
  status: z.string().min(1, 'Status is required'),
  location_id: uuidSchema.nullable().optional(),
  contact_name_id: uuidSchema.nullable().optional(),
  location: z.string().optional(),
  serial_number: z.string().optional(),
  purchase_date: dateSchema.optional(),
  warranty_end_date: dateSchema.optional(),
  manufacturer: z.string().max(255).nullable().optional(),
  model: z.string().max(255).nullable().optional(),
  vendor_id: uuidSchema.nullable().optional(),
  /** Minor units (cents). */
  purchase_cost: z.coerce.number().int().nullable().optional(),
  purchase_cost_currency: z.string().length(3).nullable().optional(),
  order_number: z.string().max(255).nullable().optional(),
  billing_profile_id: uuidSchema.nullable().optional(),
  attributes: z.record(z.string(), z.unknown()).optional()
});

// Checked per asset type in AssetService: an untagged union matched workstation first and stripped other types' fields.
const assetExtensionDataInputSchema = z.record(z.string(), z.unknown());

// Update asset schema (all fields optional)
export const updateAssetSchema = createAssetSchema.partial().extend({
  extension_data: assetExtensionDataInputSchema.optional()
});

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
  management_ip: z.union([z.ipv4(), z.ipv6()]).optional(),
  port_count: z.number().min(0).optional(),
  firmware_version: z.string().optional(),
  supports_poe: z.boolean().optional(),
  power_draw_watts: z.number().min(0).optional(),
  vlan_config: z.record(z.string(), z.any()).optional(),
  port_config: z.record(z.string(), z.any()).optional()
});

export const serverAssetSchema = z.object({
  os_type: z.string().optional(),
  os_version: z.string().optional(),
  cpu_model: z.string().optional(),
  cpu_cores: z.number().min(1).optional(),
  ram_gb: z.number().min(0).optional(),
  storage_config: z.array(z.record(z.string(), z.any())).optional(),
  raid_config: z.string().optional(),
  is_virtual: z.boolean().optional(),
  hypervisor: z.string().optional(),
  network_interfaces: z.array(z.record(z.string(), z.any())).optional(),
  primary_ip: z.union([z.ipv4(), z.ipv6()]).optional(),
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
  ip_address: z.union([z.ipv4(), z.ipv6()]).optional(),
  is_network_printer: z.boolean().optional(),
  supports_color: z.boolean().optional(),
  supports_duplex: z.boolean().optional(),
  max_paper_size: z.string().optional(),
  supported_paper_types: z.array(z.string()).optional(),
  monthly_duty_cycle: z.number().min(0).optional(),
  supply_levels: z.record(z.string(), z.number()).optional()
});

const assetExtensionSchemas: Record<string, z.ZodObject> = {
  workstation: workstationAssetSchema,
  network_device: networkDeviceAssetSchema,
  server: serverAssetSchema,
  mobile_device: mobileDeviceAssetSchema,
  printer: printerAssetSchema
};

/** Validates extension_data against the schema of the asset type; null when the type has no extension table. */
export function parseAssetExtensionData(assetType: string, data: unknown) {
  const schema = assetExtensionSchemas[assetType];
  return schema ? schema.safeParse(data) : null;
}

// Combined asset creation schema with extension data
export const createAssetWithExtensionSchema = createAssetSchema.extend({
  extension_data: assetExtensionDataInputSchema.optional()
});

// Asset filter schema
export const assetFilterSchema = baseFilterSchema.extend({
  asset_tag: z.string().optional(),
  name: z.string().optional(),
  client_id: uuidSchema.optional(),
  location_id: uuidSchema.optional(),
  contact_name_id: uuidSchema.optional(),
  asset_type: assetTypeSchema.optional(),
  status: z.string().optional(),
  location: z.string().optional(),
  manufacturer: z.string().optional(),
  model: z.string().optional(),
  vendor_id: uuidSchema.optional(),
  billing_profile_id: uuidSchema.optional(),
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
  location_id: uuidSchema.nullable().optional(),
  contact_name_id: uuidSchema.nullable().optional(),
  location: z.string().nullable(),
  serial_number: z.string().nullable(),
  purchase_date: dateSchema.nullable(),
  warranty_end_date: dateSchema.nullable(),
  manufacturer: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  vendor_id: uuidSchema.nullable().optional(),
  vendor_name: z.string().nullable().optional(),
  purchase_cost: z.coerce.number().int().nullable().optional(),
  purchase_cost_currency: z.string().nullable().optional(),
  order_number: z.string().nullable().optional(),
  billing_profile_id: uuidSchema.nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  attributes: z.record(z.string(), z.unknown()).nullable().optional(),

  // Computed/joined fields
  client_name: z.string().optional(),
  // FR-C6: the assignee's display name, joined from contacts.
  contact_name: z.string().nullable().optional(),
  // FR-E3: the group this asset belongs to, if any.
  group: z.object({
    group_id: uuidSchema,
    name: z.string(),
    kind: z.enum(['bundle', 'shared_workspace']),
    location_id: uuidSchema.nullable(),
    location_name: z.string().nullable(),
    member_count: z.number().int(),
    user_count: z.number().int()
  }).nullable().optional(),
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
    schedule_name: z.string(),
    maintenance_type: z.string(),
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

// Link a ticket to an asset (POST /api/v1/assets/{id}/tickets).
export const linkAssetTicketSchema = z.object({
  ticket_id: uuidSchema,
  relationship_type: z.string().min(1).optional(),
  notes: z.string().optional()
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
const maintenanceScheduleWriteSchema = z.object({
  schedule_name: z.string().trim().min(1).max(255),
  description: z.string().nullable().optional(),
  maintenance_type: z.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']),
  // `custom` reads its rule from schedule_config.recurrence (see maintenanceRecurrence.ts).
  frequency: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']),
  frequency_interval: z.number().int().min(1),
  // UTC only (`Z` suffix); timestamps with a numeric offset are rejected.
  next_maintenance: z.string().datetime(),
  is_active: z.boolean().optional().default(true),
  schedule_config: z.record(z.string(), z.unknown())
}).strict();

// A custom frequency needs a valid rule. On partial updates this only runs
// when both fields are present; AssetService re-checks the merged row.
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

// Response-only columns are tolerated on update (and dropped) so a client can
// PUT back a row it read; legacy and unknown fields are still rejected.
const maintenanceScheduleReadOnlyFields = [
  'schedule_id', 'asset_id', 'tenant', 'created_by', 'created_by_name',
  'created_at', 'updated_at', 'last_maintenance', 'archived_at'
] as const;

export const updateMaintenanceScheduleSchema = partialWithoutDefaults(maintenanceScheduleWriteSchema)
  .extend(Object.fromEntries(maintenanceScheduleReadOnlyFields.map((field) => [field, z.unknown().optional()])))
  .strict()
  .superRefine(requireCustomRecurrence)
  .transform((data) => {
    const writable = { ...data };
    for (const field of maintenanceScheduleReadOnlyFields) delete writable[field];
    return writable as Omit<typeof data, (typeof maintenanceScheduleReadOnlyFields)[number]>;
  });

export const maintenanceScheduleResponseSchema = z.object({
  schedule_id: uuidSchema,
  asset_id: uuidSchema,
  schedule_name: z.string(),
  description: z.string().nullable(),
  maintenance_type: z.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']),
  frequency: z.string(),
  frequency_interval: z.number().int(),
  last_maintenance: dateSchema.nullable(),
  next_maintenance: z.string().datetime(),
  is_active: z.boolean(),
  schedule_config: z.record(z.string(), z.unknown()),
  created_by: uuidSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  tenant: uuidSchema,
  
  archived_at: dateSchema.nullable(),
  created_by_name: z.string().optional()
});

export const recordMaintenanceSchema = z.object({
  // schedule_id is required: asset_maintenance_history rows are always tied to a
  // schedule (the tech records a scheduled task as done).
  schedule_id: uuidSchema,
  // Clients that render an occurrence (desktop/mobile queues) should send its
  // id.  That makes a retry unambiguously target the same unit of work, rather
  // than accidentally completing the newly-opened next occurrence.
  occurrence_id: uuidSchema.optional(),
  maintenance_type: z.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']),
  description: z.string().trim().min(1).optional(),
  // Defaults to the calling user / now when omitted (the common field case).
  performed_by: uuidSchema.optional(),
  performed_at: z.string().datetime().optional(),
  // These have no dedicated columns; they are folded into maintenance_data.
  duration_hours: z.number().min(0).optional(),
  cost: z.number().min(0).optional(),
  notes: z.string().optional(),
  parts_used: z.array(z.string()).optional(),
  maintenance_data: z.record(z.string(), z.any()).optional()
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
  maintenance_data: z.record(z.string(), z.any()).nullable(),
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
  /** Assets whose status kind is `deployable` (FR-B5). */
  deployed_assets: z.number().optional(),
  assets_by_type: z.record(z.string(), z.number()),
  assets_by_status: z.record(z.string(), z.number()),
  assets_by_client: z.record(z.string(), z.number()),
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
  include_extension_data: booleanTransform.prefault('false'),
  limit: z.string().transform(val => parseInt(val)).pipe(z.number().min(1).max(100)).prefault('25')
});

// Asset export schema
export const assetExportQuerySchema = z.object({
  format: z.enum(['csv', 'json']).optional().default('csv'),
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
