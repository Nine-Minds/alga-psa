import { ApiOpenApiRegistry, zOpenApi } from '../registry';
import { partialWithoutDefaults } from '@alga-psa/validation/lib/partialWithoutDefaults';

export function registerAssetRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Assets';

  // Any registry slug (built-in workstation/network_device/server/mobile_device/
  // printer/unknown, or a custom tenant type), so a free-form string rather than
  // a fixed enum.
  const AssetType = zOpenApi.string().describe('Asset type slug from the tenant asset type registry.');

  const AssetListQuery = registry.registerSchema(
    'AssetListQuery',
    zOpenApi.object({
      page: zOpenApi.string().optional().describe('Page number as a query string. Defaults to 1 after validation.'),
      limit: zOpenApi.string().optional().describe('Page size as a query string. Must parse to 1 through 100; defaults to 25.'),
      sort: zOpenApi.string().optional().describe('Sort column. Defaults to created_at.'),
      order: zOpenApi.enum(['asc', 'desc']).optional().describe('Sort direction. Defaults to desc.'),
      search: zOpenApi.string().optional().describe('General search filter accepted by the shared filter schema. The current AssetService.list implementation does not apply this filter.'),
      created_from: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      created_to: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      updated_from: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      updated_to: zOpenApi.string().datetime().optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      is_active: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      asset_tag: zOpenApi.string().optional().describe('Partial asset tag match using ILIKE.'),
      name: zOpenApi.string().optional().describe('Partial asset name match using ILIKE.'),
      client_id: zOpenApi.string().guid().optional().describe('Client UUID from clients.client_id.'),
      location_id: zOpenApi.string().guid().optional().describe('Client location UUID from client_locations.location_id.'),
      asset_type: AssetType.optional().describe('Asset type stored in assets.asset_type.'),
      status: zOpenApi.string().optional().describe('Exact asset status match.'),
      location: zOpenApi.string().optional().describe('Partial location match using ILIKE.'),
      client_name: zOpenApi.string().optional().describe('Partial client name match; joins clients on client_id and tenant.'),
      has_warranty: zOpenApi.enum(['true', 'false']).optional().describe('true requires warranty_end_date to be non-null; false requires it to be null.'),
      warranty_expired: zOpenApi.enum(['true', 'false']).optional().describe('true filters warranty_end_date before now; false filters future warranty dates or no warranty.'),
      maintenance_due: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but not currently applied by AssetService.list.'),
      purchase_date_from: zOpenApi.string().datetime().optional().describe('Filter purchase_date greater than or equal to this timestamp.'),
      purchase_date_to: zOpenApi.string().datetime().optional().describe('Filter purchase_date less than or equal to this timestamp.'),
      warranty_end_from: zOpenApi.string().datetime().optional().describe('Filter warranty_end_date greater than or equal to this timestamp.'),
      warranty_end_to: zOpenApi.string().datetime().optional().describe('Filter warranty_end_date less than or equal to this timestamp.'),
    }),
  );

  const AssetExportQuery = registry.registerSchema(
    'AssetExportQuery',
    zOpenApi.object({
      format: zOpenApi.enum(['csv', 'json']).optional().describe('Export format. csv (default) returns text/csv as an attachment; json returns the success envelope with the rows in data.'),
      asset_types: zOpenApi.array(AssetType).optional().describe('Filter to these asset types. Repeat the param or pass a comma-separated list.'),
      statuses: zOpenApi.array(zOpenApi.string()).optional().describe('Filter to these asset statuses. Repeat the param or pass a comma-separated list.'),
      client_ids: zOpenApi.array(zOpenApi.string().guid()).optional().describe('Filter to these client UUIDs. Repeat the param or pass a comma-separated list.'),
      fields: zOpenApi.array(zOpenApi.string()).optional().describe('Restrict exported columns to this set. Repeat the param or pass a comma-separated list.'),
    }),
  );

  const AssetIdParams = registry.registerSchema(
    'AssetIdParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Asset UUID from assets.asset_id.'),
    }),
  );

  const AssetDocumentAssociationParams = registry.registerSchema(
    'AssetDocumentAssociationParams',
    zOpenApi.object({
      associationId: zOpenApi.string().guid().describe('Document association UUID from document_associations.association_id.'),
    }),
  );

  const AssetDocumentAssociationRequest = registry.registerSchema(
    'AssetDocumentAssociationRequest',
    zOpenApi.object({
      document_id: zOpenApi.string().guid().describe('Document UUID from documents.document_id to associate with the asset.'),
      notes: zOpenApi.string().optional().describe('Optional notes stored on document_associations.notes.'),
    }),
  );

  const AssetExtensionData = registry.registerSchema(
    'AssetExtensionData',
    zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('Asset-type-specific extension data written to the corresponding extension table for workstation, network device, server, mobile device, or printer assets. Validated against the schema of the asset type (on update, the new asset_type or the stored one); unknown keys are dropped, and other asset types return 400.'),
  );

  const AssetAttributes = registry.registerSchema(
    'AssetAttributes',
    zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe("Values for a custom asset type's fields, keyed by each field's key in the tenant asset type registry fields_schema. On create, required fields must be present; on update, provided keys merge into the stored map, omitted keys remain, and required fields cannot be blanked. Other keys such as integration namespaces are stored as-is. Built-in asset types accept the map without schema validation.")
  );

  const AssetCreateRequest = registry.registerSchema(
    'AssetCreateRequest',
    zOpenApi.object({
      client_id: zOpenApi.string().guid().describe('Client UUID from clients.client_id. Required.'),
      asset_type: AssetType.describe('Must be a built-in slug or registered custom slug; unknown slugs return 400.'),
      asset_tag: zOpenApi.string().min(1).max(255).describe('Required tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).describe('Required asset name.'),
      status: zOpenApi.string().min(1).describe('Required asset status.'),
      location_id: zOpenApi.string().guid().nullable().optional().describe('Optional client_locations.location_id link. Validated to belong to client_id.'),
      location: zOpenApi.string().optional().describe('Optional free-text asset location.'),
      serial_number: zOpenApi.string().optional().describe('Optional serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Optional purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Optional warranty end date/time.'),
      manufacturer: zOpenApi.string().max(255).nullable().optional().describe('Hardware make. RMM sync fills it when the provider reports one.'),
      model: zOpenApi.string().max(255).nullable().optional().describe('Hardware model. A first-class column, not a system_info lookup.'),
      vendor_id: zOpenApi.string().guid().nullable().optional().describe('Supplier; an inventory vendors.vendor_id of this tenant.'),
      purchase_cost: zOpenApi.number().int().nullable().optional().describe('Purchase cost in minor units (cents).'),
      purchase_cost_currency: zOpenApi.string().length(3).nullable().optional().describe('ISO currency code; defaults to the tenant currency when a cost is written without one.'),
      order_number: zOpenApi.string().max(255).nullable().optional().describe('Purchase order number.'),
      billing_profile_id: zOpenApi.string().guid().nullable().optional().describe('Billing profile for work on this device. Must belong to the asset client and be active; cleared when the client changes.'),
      attributes: AssetAttributes.optional(),
      extension_data: AssetExtensionData.optional(),
    }),
  );

  const AssetUpdateData = registry.registerSchema(
    'AssetUpdateData',
    zOpenApi.object({
      client_id: zOpenApi.string().guid().optional().describe('Client UUID to assign to the asset.'),
      asset_type: AssetType.optional().describe('Must be a built-in slug or registered custom slug; unknown slugs return 400.'),
      asset_tag: zOpenApi.string().min(1).max(255).optional().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).optional().describe('Asset name.'),
      status: zOpenApi.string().min(1).optional().describe('Asset status.'),
      location_id: zOpenApi.string().guid().nullable().optional().describe('Client_locations.location_id link. Pass null to clear.'),
      location: zOpenApi.string().optional().describe('Free-text asset location.'),
      serial_number: zOpenApi.string().optional().describe('Serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Warranty end date/time.'),
      manufacturer: zOpenApi.string().max(255).nullable().optional().describe('Hardware make. RMM sync fills it when the provider reports one.'),
      model: zOpenApi.string().max(255).nullable().optional().describe('Hardware model. A first-class column, not a system_info lookup.'),
      vendor_id: zOpenApi.string().guid().nullable().optional().describe('Supplier; an inventory vendors.vendor_id of this tenant.'),
      purchase_cost: zOpenApi.number().int().nullable().optional().describe('Purchase cost in minor units (cents).'),
      purchase_cost_currency: zOpenApi.string().length(3).nullable().optional().describe('ISO currency code; defaults to the tenant currency when a cost is written without one.'),
      order_number: zOpenApi.string().max(255).nullable().optional().describe('Purchase order number.'),
      billing_profile_id: zOpenApi.string().guid().nullable().optional().describe('Billing profile for work on this device. Must belong to the asset client and be active; cleared when the client changes.'),
      attributes: AssetAttributes.optional(),
      extension_data: AssetExtensionData.optional().describe('Provided keys are written to the extension row; omitted keys remain.'),
    }),
  );

  const AssetBulkUpdateRequest = registry.registerSchema(
    'AssetBulkUpdateRequest',
    zOpenApi.object({
      assets: zOpenApi.array(zOpenApi.object({
        asset_id: zOpenApi.string().guid().describe('Asset UUID from assets.asset_id.'),
        data: AssetUpdateData.describe('Partial update data validated with updateAssetSchema.'),
      })).min(1).max(50).describe('Assets to update. Limited to 1 through 50 entries by validation.'),
    }),
  );

  const AssetBulkStatusRequest = registry.registerSchema(
    'AssetBulkStatusRequest',
    zOpenApi.object({
      asset_ids: zOpenApi.array(zOpenApi.string().guid()).min(1).max(50).describe('Asset UUIDs from assets.asset_id. Limited to 1 through 50 entries by validation.'),
      status: zOpenApi.string().min(1).describe('New status assigned to every asset in asset_ids.'),
    }),
  );

  const HateoasLink = registry.registerSchema(
    'HateoasLink',
    zOpenApi.object({
      href: zOpenApi.string().describe('Target URL for the related operation.'),
      method: zOpenApi.string().optional().describe('HTTP method for the link when supplied.'),
    }),
  );

  const AssetLinks = registry.registerSchema(
    'AssetLinks',
    zOpenApi.object({
      self: HateoasLink.optional(),
      edit: HateoasLink.optional(),
      delete: HateoasLink.optional(),
      list: HateoasLink.optional(),
      documents: HateoasLink.optional(),
      maintenance: HateoasLink.optional(),
      history: HateoasLink.optional(),
    }).describe('HATEOAS links generated from the asset_id.'),
  );

  const AssetDocumentAssociationRow = registry.registerSchema(
    'AssetDocumentAssociationRow',
    zOpenApi.object({
      association_id: zOpenApi.string().guid().describe('Primary key from document_associations.association_id.'),
      entity_type: zOpenApi.literal('asset').describe('Entity type stored on document_associations; always asset for these routes.'),
      entity_id: zOpenApi.string().guid().describe('Asset UUID from document_associations.entity_id.'),
      document_id: zOpenApi.string().guid().describe('Document UUID from document_associations.document_id.'),
      notes: zOpenApi.string().nullable().optional().describe('Optional association notes.'),
      tenant: zOpenApi.string().guid().describe('Tenant UUID from document_associations.tenant.'),
      created_at: zOpenApi.string().datetime().optional().describe('Association creation timestamp.'),
      original_filename: zOpenApi.string().optional().describe('Original filename from the joined documents table, present on list responses.'),
      file_size: zOpenApi.number().optional().describe('File size in bytes from the joined documents table, present on list responses.'),
      mime_type: zOpenApi.string().optional().describe('MIME type from the joined documents table, present on list responses.'),
      uploaded_at: zOpenApi.string().datetime().optional().describe('Document upload timestamp from the joined documents table, present on list responses.'),
    }),
  );

  const AssetDocumentListPayload = registry.registerSchema(
    'AssetDocumentListPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetDocumentAssociationRow).describe('Document association rows for the asset. Empty when no associations exist or the asset is not found.'),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
        create: HateoasLink.optional(),
        parent: HateoasLink.optional(),
      }).describe('Collection links. The controller currently points these at /api/v2/assets paths.'),
    }),
  );

  const AssetDocumentListResponse = registry.registerSchema(
    'AssetDocumentListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetDocumentListPayload,
      meta: zOpenApi.object({
        timestamp: zOpenApi.string().datetime(),
        version: zOpenApi.string(),
      }),
    }),
  );

  const AssetDocumentAssociationPayload = registry.registerSchema(
    'AssetDocumentAssociationPayload',
    zOpenApi.object({
      data: AssetDocumentAssociationRow.describe('Inserted document association row returned from document_associations.returning(*).'),
    }),
  );

  const AssetDocumentAssociationResponse = registry.registerSchema(
    'AssetDocumentAssociationResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetDocumentAssociationPayload,
      meta: zOpenApi.object({
        timestamp: zOpenApi.string().datetime(),
        version: zOpenApi.string(),
      }),
    }),
  );

  const AssetResource = registry.registerSchema(
    'AssetResource',
    zOpenApi.object({
      asset_id: zOpenApi.string().guid().describe('Primary key from assets.asset_id.'),
      client_id: zOpenApi.string().guid().describe('Client UUID from assets.client_id.'),
      asset_type: AssetType.describe('Asset type stored in assets.asset_type.'),
      asset_tag: zOpenApi.string().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().describe('Asset display name.'),
      status: zOpenApi.string().describe('Asset status.'),
      location_id: zOpenApi.string().guid().nullable().optional().describe('Client_locations.location_id link, when set.'),
      location: zOpenApi.string().nullable().optional().describe('Asset location, when recorded.'),
      serial_number: zOpenApi.string().nullable().optional().describe('Asset serial number, when recorded.'),
      purchase_date: zOpenApi.string().nullable().optional().describe('Asset purchase date from assets.purchase_date.'),
      warranty_end_date: zOpenApi.string().nullable().optional().describe('Warranty end date from assets.warranty_end_date.'),
      contact_name_id: zOpenApi.string().guid().nullable().optional().describe('The contact this asset is assigned to; drives portal contact-scoped visibility.'),
      manufacturer: zOpenApi.string().nullable().optional().describe('Hardware make from assets.manufacturer.'),
      model: zOpenApi.string().nullable().optional().describe('Hardware model from assets.model.'),
      vendor_id: zOpenApi.string().guid().nullable().optional().describe('Supplier from assets.vendor_id (inventory vendors).'),
      vendor_name: zOpenApi.string().nullable().optional().describe('Supplier name from the joined vendors row.'),
      purchase_cost: zOpenApi.number().int().nullable().optional().describe('Purchase cost in minor units (cents).'),
      purchase_cost_currency: zOpenApi.string().nullable().optional().describe('ISO currency code of purchase_cost.'),
      order_number: zOpenApi.string().nullable().optional().describe('Purchase order number from assets.order_number.'),
      billing_profile_id: zOpenApi.string().guid().nullable().optional().describe('Billing profile for work on this device; null means the location default or the client default applies.'),
      created_at: zOpenApi.string().datetime().describe('Asset creation timestamp.'),
      updated_at: zOpenApi.string().datetime().describe('Asset last update timestamp.'),
      tenant: zOpenApi.string().guid().describe('Tenant UUID from assets.tenant; filtered to the authenticated request context.'),
      attributes: AssetAttributes.nullable().optional().describe('Stored custom-type attribute values and integration namespaces.'),
      client_name: zOpenApi.string().optional().describe('Client name selected from the joined clients table.'),
      warranty_status: zOpenApi.enum(['no_warranty', 'expired', 'expiring_soon', 'active']).optional().describe('Computed from warranty_end_date by SQL CASE expression.'),
      maintenance_status: zOpenApi.string().optional().describe('Optional computed maintenance status when present in service results.'),
      extension_data: AssetExtensionData.nullable().optional().describe('Asset-type-specific extension data returned by getWithDetails after create.'),
      relationships: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())).optional().describe('Related asset rows included by getWithDetails after create.'),
      documents: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())).optional().describe('Associated document rows included by getWithDetails after create.'),
      maintenance_schedules: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())).optional().describe('Maintenance schedule rows included by getWithDetails after create.'),
      _links: AssetLinks.optional(),
    }),
  );

  const Pagination = registry.registerSchema(
    'AssetListPagination',
    zOpenApi.object({
      page: zOpenApi.number().int().describe('Current page number.'),
      limit: zOpenApi.number().int().describe('Page size.'),
      total: zOpenApi.number().int().describe('Total matching asset count.'),
      totalPages: zOpenApi.number().int().describe('Total number of pages calculated from total and limit.'),
    }),
  );

  const AssetCollectionLinks = registry.registerSchema(
    'AssetCollectionLinks',
    zOpenApi.object({
      self: HateoasLink.optional(),
      create: HateoasLink.optional(),
      search: HateoasLink.optional(),
      export: HateoasLink.optional(),
      stats: HateoasLink.optional(),
    }).describe('Collection links returned by ApiAssetController.list. These currently point at /api/v2/assets paths.'),
  );

  const ApiResponseMeta = registry.registerSchema(
    'ApiResponseMeta',
    zOpenApi.object({
      timestamp: zOpenApi.string().datetime().describe('Response timestamp generated by createApiResponse/createErrorResponse.'),
      version: zOpenApi.string().describe('API response version string.'),
    }),
  );

  const AssetListPayload = registry.registerSchema(
    'AssetListPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('Asset records for the requested page.'),
      pagination: Pagination,
      _links: AssetCollectionLinks,
    }),
  );

  const AssetListResponse = registry.registerSchema(
    'AssetListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true).describe('Indicates the controller returned a successful response envelope.'),
      data: AssetListPayload.describe('Nested payload passed to createApiResponse by ApiAssetController.list.'),
      meta: ApiResponseMeta,
    }),
  );

  const AssetResourcePayload = registry.registerSchema(
    'AssetResourcePayload',
    zOpenApi.object({
      data: AssetResource.describe('Asset record returned by the service.'),
    }),
  );

  const AssetResourceResponse = registry.registerSchema(
    'AssetResourceResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetResourcePayload.describe('Nested payload passed to createApiResponse by ApiAssetController.create.'),
      meta: ApiResponseMeta,
    }),
  );

  const AssetBulkUpdatePayload = registry.registerSchema(
    'AssetBulkUpdatePayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('Updated asset rows returned from AssetService.update.'),
      message: zOpenApi.string().describe('Human-readable count of updated assets.'),
    }),
  );

  const AssetBulkUpdateResponse = registry.registerSchema(
    'AssetBulkUpdateResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetBulkUpdatePayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetExportJsonPayload = registry.registerSchema(
    'AssetExportJsonPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('All asset rows returned by AssetService.list with default list options. Export filters are currently not applied.'),
    }),
  );

  const AssetExportJsonResponse = registry.registerSchema(
    'AssetExportJsonResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetExportJsonPayload,
      meta: ApiResponseMeta,
    }),
  );

  const ApiErrorEnvelope = registry.registerSchema(
    'AssetApiErrorEnvelope',
    zOpenApi.object({
      success: zOpenApi.literal(false).describe('Indicates the API response is an error envelope.'),
      error: zOpenApi.object({
        message: zOpenApi.string().describe('Human-readable error message.'),
        code: zOpenApi.string().describe('Machine-readable error code such as VALIDATION_ERROR or INTERNAL_ERROR.'),
        details: zOpenApi.unknown().optional().describe('Optional structured details, including Zod validation errors.'),
      }),
      meta: ApiResponseMeta.optional(),
    }),
  );

  const MiddlewareUnauthorizedResponse = registry.registerSchema(
    'AssetMiddlewareUnauthorizedResponse',
    zOpenApi.object({
      error: zOpenApi.string().describe('Middleware-level error, usually Unauthorized: API key missing.'),
    }),
  );

  const MaintenanceScheduleParams = registry.registerSchema(
    'AssetMaintenanceScheduleParams',
    zOpenApi.object({
      scheduleId: zOpenApi.string().guid().describe('Maintenance schedule UUID from asset_maintenance_schedules.schedule_id.'),
    }),
  );

  const AssetRelationshipParams = registry.registerSchema(
    'AssetRelationshipParams',
    zOpenApi.object({
      relationshipId: zOpenApi.string().guid().describe('Asset relationship UUID from asset_relationships.relationship_id.'),
    }),
  );

  const MaintenanceScheduleWrite = zOpenApi.object({
    schedule_name: zOpenApi.string().trim().min(1).max(255).describe('Name displayed in the asset maintenance UI.'),
    description: zOpenApi.string().nullable().optional().describe('Optional maintenance instructions.'),
    maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']).describe('Maintenance type stored by the UI and database.'),
    frequency: zOpenApi.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).describe('Recurrence frequency, multiplied by frequency_interval. Does not change the explicit next_maintenance timestamp. `custom` takes its rule from schedule_config.recurrence.'),
    frequency_interval: zOpenApi.number().int().min(1).describe('Positive integer frequency multiplier; monthly with 6 means every six months.'),
    next_maintenance: zOpenApi.string().datetime().describe('Explicit next due timestamp, used unchanged for the initial open occurrence. Must be an ISO 8601 UTC timestamp with a `Z` suffix (e.g. 2026-11-01T13:00:00.000Z); values with a numeric offset such as -04:00 are rejected.'),
    is_active: zOpenApi.boolean().optional().describe('Whether the schedule is active.'),
    schedule_config: zOpenApi.object({
      recurrence: zOpenApi.object({
        unit: zOpenApi.enum(['days', 'weeks', 'months', 'years']).describe('Unit multiplied by frequency_interval.'),
        weekdays: zOpenApi.array(zOpenApi.number().int().min(0).max(6)).min(1).optional().describe('Weeks only. 0 = Sunday … 6 = Saturday. The next due date is the next listed weekday in the current week (weeks start on Sunday); after the last one it jumps frequency_interval weeks to the first listed weekday.'),
        days_of_month: zOpenApi.array(zOpenApi.number().int().min(1).max(31)).min(1).optional().describe('Months only. The next due date is the next listed day in the current month; after the last one it jumps frequency_interval months to the first listed day. Days are clamped to the month length (31 in February becomes 28/29).'),
      }).strict().optional().describe('Required when frequency is `custom`; ignored for the fixed frequencies. Example: frequency_interval 2 with { "unit": "weeks", "weekdays": [1, 4] } is every other week on Monday and Thursday.'),
    }).catchall(zOpenApi.unknown()).describe('Scheduling configuration. Use {} for the fixed frequencies. `recurrence` is required for `custom`; other keys such as `checklist` are stored as-is.'),
  }).strict();

  const MaintenanceScheduleUpdateRequest = registry.registerSchema(
    'AssetMaintenanceScheduleUpdateRequest',
    partialWithoutDefaults(MaintenanceScheduleWrite),
  );

  const MaintenanceScheduleResource = registry.registerSchema(
    'AssetMaintenanceScheduleResource',
    zOpenApi.object({
      schedule_id: zOpenApi.string().guid().describe('Primary key from asset_maintenance_schedules.schedule_id.'),
      asset_id: zOpenApi.string().guid().describe('Asset UUID from asset_maintenance_schedules.asset_id.'),
      schedule_name: zOpenApi.string().describe('Maintenance schedule name.'),
      description: zOpenApi.string().nullable().describe('Maintenance instructions.'),
      maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']),
      frequency: zOpenApi.string().describe('Recurrence frequency.'),
      frequency_interval: zOpenApi.number().int().describe('Frequency multiplier.'),
      last_maintenance: zOpenApi.string().nullable().optional().describe('Last recorded maintenance date/time.'),
      next_maintenance: zOpenApi.string().datetime().describe('Next due date/time.'),
      created_by: zOpenApi.string().guid().describe('Authenticated caller who created the schedule; not a writable assignee.'),
      created_by_name: zOpenApi.string().optional().describe('Creator display name included in list results.'),
      archived_at: zOpenApi.string().nullable().optional().describe('Archive timestamp.'),
      is_active: zOpenApi.boolean().describe('Whether the schedule is active.'),
      schedule_config: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).describe('Custom scheduling configuration.'),
      created_at: zOpenApi.string().datetime().optional().describe('Creation timestamp.'),
      updated_at: zOpenApi.string().datetime().optional().describe('Last update timestamp.'),
      tenant: zOpenApi.string().guid().describe('Tenant UUID scoped from the request context.'),
    }),
  );

  const MaintenanceSchedulePayload = registry.registerSchema(
    'AssetMaintenanceSchedulePayload',
    zOpenApi.object({
      data: MaintenanceScheduleResource.describe('Created or updated schedule row.'),
    }),
  );

  const MaintenanceScheduleResponse = registry.registerSchema(
    'AssetMaintenanceScheduleResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: MaintenanceSchedulePayload,
      meta: ApiResponseMeta,
    }),
  );

  const MaintenanceScheduleCreateRequest = registry.registerSchema(
    'AssetMaintenanceScheduleCreateRequest',
    MaintenanceScheduleWrite.extend({
      is_active: zOpenApi.boolean().default(true).describe('Whether the schedule is active; defaults to true.'),
    }),
  );

  const MaintenanceScheduleListPayload = registry.registerSchema(
    'AssetMaintenanceScheduleListPayload',
    zOpenApi.object({
      data: zOpenApi.array(MaintenanceScheduleResource).describe('Maintenance schedule rows for the asset. Empty when no schedules exist or the asset is not found.'),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
        create: HateoasLink.optional(),
        history: HateoasLink.optional(),
        parent: HateoasLink.optional(),
      }).describe('Collection links. The controller currently points these at /api/v2/assets paths.'),
    }),
  );

  const MaintenanceScheduleListResponse = registry.registerSchema(
    'AssetMaintenanceScheduleListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: MaintenanceScheduleListPayload,
      meta: ApiResponseMeta,
    }),
  );

  const MaintenanceHistoryResource = registry.registerSchema(
    'AssetMaintenanceHistoryResource',
    zOpenApi.object({
      history_id: zOpenApi.string().guid().describe('Primary key from asset_maintenance_history.history_id.'),
      asset_id: zOpenApi.string().guid().describe('Asset UUID from asset_maintenance_history.asset_id.'),
      schedule_id: zOpenApi.string().guid().nullable().optional().describe('Optional related maintenance schedule UUID.'),
      maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']).or(zOpenApi.string()).describe('Maintenance type recorded for the history row.'),
      performed_by: zOpenApi.string().guid().describe('User UUID supplied in the maintenance record.'),
      performed_at: zOpenApi.string().datetime().describe('Timestamp when maintenance was performed.'),
      duration_hours: zOpenApi.number().nullable().optional().describe('Maintenance duration in hours, when recorded.'),
      cost: zOpenApi.number().nullable().optional().describe('Maintenance cost, when recorded.'),
      notes: zOpenApi.string().nullable().optional().describe('Free-text notes.'),
      parts_used: zOpenApi.array(zOpenApi.string()).nullable().optional().describe('Parts used, when recorded.'),
      maintenance_data: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional().describe('Arbitrary structured maintenance data.'),
      description: zOpenApi.string().nullable().optional().describe('Description column when present in the maintenance history table.'),
      created_at: zOpenApi.string().datetime().describe('History creation timestamp.'),
      tenant: zOpenApi.string().guid().describe('Tenant UUID scoped from the request context.'),
      performed_by_user_name: zOpenApi.string().nullable().optional().describe('Concatenated user name from the joined users table.'),
    }),
  );

  const MaintenanceHistoryPayload = registry.registerSchema(
    'AssetMaintenanceHistoryPayload',
    zOpenApi.object({
      data: zOpenApi.array(MaintenanceHistoryResource).describe('Maintenance history rows ordered by performed_at descending.'),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
        schedules: HateoasLink.optional(),
        parent: HateoasLink.optional(),
      }).describe('History links. The controller currently points these at /api/v2/assets paths.'),
    }),
  );

  const MaintenanceHistoryResponse = registry.registerSchema(
    'AssetMaintenanceHistoryResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: MaintenanceHistoryPayload,
      meta: ApiResponseMeta,
    }),
  );

  const RecordMaintenanceRequest = registry.registerSchema(
    'AssetRecordMaintenanceRequest',
    zOpenApi.object({
      schedule_id: zOpenApi.string().guid().optional().describe('Optional maintenance schedule UUID. If present and found for the tenant, the schedule last_maintenance and next_maintenance are updated.'),
      maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']).describe('Required type of maintenance performed.'),
      performed_by: zOpenApi.string().guid().describe('Required UUID of the user who performed maintenance. The service does not validate this user before insert.'),
      performed_at: zOpenApi.string().datetime().describe('Required timestamp when maintenance was performed.'),
      duration_hours: zOpenApi.number().min(0).optional().describe('Optional duration in hours.'),
      cost: zOpenApi.number().min(0).optional().describe('Optional cost.'),
      notes: zOpenApi.string().optional().describe('Optional notes.'),
      parts_used: zOpenApi.array(zOpenApi.string()).optional().describe('Optional list of parts used.'),
      maintenance_data: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional().describe('Optional structured maintenance data.'),
    }),
  );

  const RecordMaintenancePayload = registry.registerSchema(
    'AssetRecordMaintenancePayload',
    zOpenApi.object({
      data: MaintenanceHistoryResource.describe('Inserted asset_maintenance_history row returned from the database.'),
    }),
  );

  const RecordMaintenanceResponse = registry.registerSchema(
    'AssetRecordMaintenanceResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: RecordMaintenancePayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetRelationshipCreateRequest = registry.registerSchema(
    'AssetRelationshipCreateRequest',
    zOpenApi.object({
      related_asset_id: zOpenApi.string().guid().describe('Related asset UUID from assets.asset_id.'),
      relationship_type: zOpenApi.string().min(1).describe('Free-form relationship type. Must be non-empty.'),
    }),
  );

  const AssetRelationshipRow = registry.registerSchema(
    'AssetRelationshipRow',
    zOpenApi.object({
      relationship_id: zOpenApi.string().guid().describe('Primary key from asset_relationships.relationship_id.'),
      asset_id: zOpenApi.string().guid().describe('Source asset UUID from asset_relationships.asset_id.'),
      related_asset_id: zOpenApi.string().guid().describe('Related asset UUID from asset_relationships.related_asset_id.'),
      relationship_type: zOpenApi.string().describe('Free-form relationship type.'),
      tenant: zOpenApi.string().guid().describe('Tenant UUID from asset_relationships.tenant.'),
      created_at: zOpenApi.string().datetime().optional().describe('Relationship creation timestamp.'),
      asset_tag: zOpenApi.string().optional().describe('Related asset tag from joined related_assets, present in list responses.'),
      related_asset_name: zOpenApi.string().optional().describe('Related asset name from joined related_assets, present in list responses.'),
      asset_type: AssetType.optional().describe('Related asset type from joined related_assets, present in list responses.'),
      status: zOpenApi.string().optional().describe('Related asset status from joined related_assets, present in list responses.'),
    }),
  );

  const AssetRelationshipListPayload = registry.registerSchema(
    'AssetRelationshipListPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetRelationshipRow).describe('Relationship rows for the asset. Empty when no relationships exist or the asset is not found.'),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
        create: HateoasLink.optional(),
        parent: HateoasLink.optional(),
      }).describe('Relationship links. The controller currently points these at /api/v2/assets paths.'),
    }),
  );

  const AssetRelationshipListResponse = registry.registerSchema(
    'AssetRelationshipListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetRelationshipListPayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetRelationshipPayload = registry.registerSchema(
    'AssetRelationshipPayload',
    zOpenApi.object({
      data: AssetRelationshipRow.describe('Inserted asset_relationships row returned from the database.'),
    }),
  );

  const AssetRelationshipResponse = registry.registerSchema(
    'AssetRelationshipResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetRelationshipPayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetSearchQuery = registry.registerSchema(
    'AssetSearchQuery',
    zOpenApi.object({
      query: zOpenApi.string().min(1).describe('Required search term used in ILIKE clauses.'),
      fields: zOpenApi.array(zOpenApi.enum(['asset_tag', 'name', 'serial_number', 'location', 'client_name'])).optional().describe('Search fields. If omitted, the service searches asset_tag, name, serial_number, and location.'),
      asset_types: zOpenApi.array(AssetType).optional().describe('Optional asset type filters.'),
      statuses: zOpenApi.array(zOpenApi.string()).optional().describe('Optional status filters.'),
      client_ids: zOpenApi.array(zOpenApi.string().guid()).optional().describe('Optional client UUID filters.'),
      include_extension_data: zOpenApi.enum(['true', 'false']).optional().describe('When true, the service fetches asset-type-specific extension data for every result.'),
      limit: zOpenApi.string().optional().describe('Maximum result count as a query string. Must parse to 1 through 100; defaults to 25.'),
    }),
  );

  const AssetSearchPayload = registry.registerSchema(
    'AssetSearchPayload',
    zOpenApi.object({
      data: zOpenApi.array(AssetResource).describe('Matching assets with HATEOAS links.'),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
      }).describe('Search collection link. The controller currently points this at /api/v2/assets/search.'),
    }),
  );

  const AssetSearchResponse = registry.registerSchema(
    'AssetSearchResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetSearchPayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetStatsPayload = registry.registerSchema(
    'AssetStatsPayload',
    zOpenApi.object({
      data: zOpenApi.object({
        total_assets: zOpenApi.number().int().describe('Total asset count for the tenant.'),
        assets_added_this_month: zOpenApi.number().int().describe('Count of assets created since the start of the current month.'),
        average_asset_age_days: zOpenApi.number().int().nullable().describe('Rounded average age in days from purchase_date, or null when unavailable.'),
        total_asset_value: zOpenApi.number().describe('Sum of purchase_price values, treating null as zero.'),
        assets_by_type: zOpenApi.record(zOpenApi.string(), zOpenApi.number().int()).describe('Counts grouped by assets.asset_type.'),
        assets_by_status: zOpenApi.record(zOpenApi.string(), zOpenApi.number().int()).describe('Counts grouped by assets.status.'),
        assets_by_client: zOpenApi.record(zOpenApi.string(), zOpenApi.number().int()).describe('Top client counts grouped by clients.client_name. The service limits this grouping to 10 clients.'),
        warranty_expiring_soon: zOpenApi.number().int().describe('Count of warranties ending within 30 days.'),
        warranty_expired: zOpenApi.number().int().describe('Count of warranties already expired.'),
        maintenance_due: zOpenApi.number().int().describe('Count of active maintenance schedules with next_maintenance due now or earlier.'),
        maintenance_overdue: zOpenApi.number().int().describe('Count of active maintenance schedules overdue by more than seven days.'),
      }),
      _links: zOpenApi.object({
        self: HateoasLink.optional(),
        assets: HateoasLink.optional(),
      }).describe('Stats links. The controller currently points these at /api/v2/assets paths.'),
    }),
  );

  const AssetStatsResponse = registry.registerSchema(
    'AssetStatsResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetStatsPayload,
      meta: ApiResponseMeta,
    }),
  );

  const AssetTicketRow = registry.registerSchema(
    'AssetTicketRow',
    zOpenApi.object({
      ticket_id: zOpenApi.string().guid().describe('Ticket UUID from tickets.ticket_id.'),
      ticket_number: zOpenApi.string().describe('Human-readable ticket number from tickets.ticket_number.'),
      title: zOpenApi.string().nullable().optional().describe('Ticket title.'),
      status_id: zOpenApi.string().guid().nullable().optional().describe('Status UUID from tickets.status_id.'),
      status_name: zOpenApi.string().nullable().optional().describe('Status name from the joined statuses table.'),
      is_closed: zOpenApi.boolean().nullable().optional().describe('Whether the ticket is closed.'),
      priority_id: zOpenApi.string().guid().nullable().optional().describe('Priority UUID from tickets.priority_id.'),
      assigned_to: zOpenApi.string().guid().nullable().optional().describe('Assigned user UUID from tickets.assigned_to.'),
      client_id: zOpenApi.string().guid().nullable().optional().describe('Client UUID from tickets.client_id.'),
      board_id: zOpenApi.string().guid().nullable().optional().describe('Board UUID from tickets.board_id.'),
      entered_at: zOpenApi.string().nullable().optional().describe('Ticket creation timestamp.'),
      updated_at: zOpenApi.string().nullable().optional().describe('Ticket last update timestamp.'),
      relationship_type: zOpenApi.string().describe('Association type from asset_associations.relationship_type (e.g. affected, related).'),
      association_notes: zOpenApi.string().nullable().optional().describe('Optional notes from asset_associations.notes.'),
      linked_at: zOpenApi.string().nullable().optional().describe('When the asset was linked to the ticket, from asset_associations.created_at.'),
    }),
  );

  const AssetTicketListResponse = registry.registerSchema(
    'AssetTicketListResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: zOpenApi.array(AssetTicketRow).describe('Tickets linked to the asset via asset_associations, ordered by ticket updated_at descending. Empty when no associations exist or the asset is not found.'),
      meta: ApiResponseMeta,
    }),
  );

  // Assets linked to a ticket. Returned by GET /api/v1/tickets/{id}/assets,
  // which responds with the apiMiddleware envelope ({ data } — no `success`).
  const TicketAssetRow = registry.registerSchema(
    'TicketAssetRow',
    AssetResource.extend({
      relationship_type: zOpenApi.string().describe('Association type from asset_associations.relationship_type (e.g. affected, related).'),
      association_notes: zOpenApi.string().nullable().optional().describe('Optional notes from asset_associations.notes.'),
      linked_at: zOpenApi.string().nullable().optional().describe('When the asset was linked to the ticket, from asset_associations.created_at.'),
    }),
  );

  const TicketAssetListResponse = registry.registerSchema(
    'TicketAssetListResponse',
    zOpenApi.object({
      data: zOpenApi.array(TicketAssetRow).describe('Assets linked to the ticket via asset_associations, ordered by link time descending. Empty when no associations exist or the ticket is not found.'),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  // The asset_associations row created by the link endpoints (returned by both
  // POST /assets/{id}/tickets and POST /tickets/{id}/assets).
  const AssetAssociationRow = registry.registerSchema(
    'AssetAssociationRow',
    zOpenApi.object({
      tenant: zOpenApi.string().guid().describe('Tenant UUID from asset_associations.tenant.'),
      asset_id: zOpenApi.string().guid().describe('Asset UUID from asset_associations.asset_id.'),
      entity_id: zOpenApi.string().guid().describe('Linked entity UUID — the ticket_id, from asset_associations.entity_id.'),
      entity_type: zOpenApi.literal('ticket').describe("Always 'ticket' for these endpoints."),
      relationship_type: zOpenApi.string().describe('Association type from asset_associations.relationship_type (defaults to affected).'),
      notes: zOpenApi.string().nullable().optional().describe('Optional notes from asset_associations.notes.'),
      created_by: zOpenApi.string().guid().describe('Creator user UUID from asset_associations.created_by.'),
      created_at: zOpenApi.string().describe('Link creation timestamp from asset_associations.created_at.'),
    }),
  );

  // POST /api/v1/assets/{id}/tickets body.
  const AssetTicketLinkRequest = registry.registerSchema(
    'AssetTicketLinkRequest',
    zOpenApi.object({
      ticket_id: zOpenApi.string().guid().describe('Ticket UUID to link to the asset.'),
      relationship_type: zOpenApi.string().min(1).optional().describe('Optional association type; defaults to affected.'),
      notes: zOpenApi.string().optional().describe('Optional notes stored on asset_associations.notes.'),
    }),
  );

  // POST /api/v1/tickets/{id}/assets body.
  const TicketAssetLinkRequest = registry.registerSchema(
    'TicketAssetLinkRequest',
    zOpenApi.object({
      asset_id: zOpenApi.string().guid().describe('Asset UUID to link to the ticket.'),
      relationship_type: zOpenApi.string().min(1).optional().describe('Optional association type; defaults to affected.'),
      notes: zOpenApi.string().optional().describe('Optional notes stored on asset_associations.notes.'),
    }),
  );

  // createApiResponse envelope ({ success, data, meta }) — used by the asset-side POST.
  const AssetTicketLinkResponse = registry.registerSchema(
    'AssetTicketLinkResponse',
    zOpenApi.object({
      success: zOpenApi.literal(true),
      data: AssetAssociationRow.describe('The inserted asset_associations row.'),
      meta: ApiResponseMeta,
    }),
  );

  // apiMiddleware envelope ({ data } — no success) — used by the ticket-side POST.
  const TicketAssetLinkResponse = registry.registerSchema(
    'TicketAssetLinkResponse',
    zOpenApi.object({
      data: AssetAssociationRow.describe('The inserted asset_associations row.'),
      meta: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );

  // DELETE /api/v1/assets/{id}/tickets/{ticketId} params.
  const AssetTicketLinkParams = registry.registerSchema(
    'AssetTicketLinkParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Asset UUID from assets.asset_id.'),
      ticketId: zOpenApi.string().guid().describe('Ticket UUID from tickets.ticket_id.'),
    }),
  );

  // DELETE /api/v1/tickets/{id}/assets/{assetId} params.
  const TicketAssetLinkParams = registry.registerSchema(
    'TicketAssetLinkParams',
    zOpenApi.object({
      id: zOpenApi.string().guid().describe('Ticket UUID from tickets.ticket_id.'),
      assetId: zOpenApi.string().guid().describe('Asset UUID from assets.asset_id.'),
    }),
  );

  const assetRouteExtensions = {
    'x-tenant-scoped': true,
    'x-request-context-required': true,
    'x-current-auth-wiring-missing': true,
  };

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets',
    summary: 'List assets',
    description:
      'Lists assets for the authenticated tenant with pagination, sorting, and asset filters. The controller validates query parameters with assetListQuerySchema, queries assets filtered by assets.tenant, joins clients for client_name, computes warranty_status, and adds HATEOAS links from asset_id. The route is authenticated and tenant-scoped via withApiKeyRouteAuth (req.context is populated before the handler runs).',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetListQuery,
    },
    responses: {
      200: {
        description: 'Paginated asset list returned successfully. The pagination and links are nested under the top-level data envelope.',
        schema: AssetListResponse,
      },
      400: {
        description: 'Query parameter validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-unapplied-validated-filters': ['maintenance_due', 'is_active', 'search', 'created_from', 'created_to', 'updated_from', 'updated_to'],
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets',
    summary: 'Create asset',
    description:
      'Creates an asset for the authenticated tenant. The request body is validated with createAssetWithExtensionSchema; client_id, asset_type, asset_tag, name, and status are required. Custom attributes are checked against the registered type schema and required fields must be present. Unknown asset_type slugs and invalid/missing required attributes return 400. AssetService.create writes the attributes map, optionally upserts extension_data, publishes ASSET_CREATED, and returns getWithDetails.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetCreateRequest,
        description: 'Asset fields plus optional asset-type-specific extension_data.',
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Asset created successfully.',
        schema: AssetResourceResponse,
      },
      400: {
        description: 'Request validation failed, asset_type is not a built-in or registered slug, or custom attributes are invalid or missing required fields.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to create assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'create',
      'x-publishes-event': 'ASSET_CREATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/bulk-status',
    summary: 'Bulk update asset status',
    description:
      'Updates the status field for up to 50 assets in the authenticated tenant. The controller validates asset_ids and status with bulkAssetStatusSchema, then calls AssetService.update for each asset_id with { status }. Each update is tenant-scoped by assets.asset_id and assets.tenant and publishes an ASSET_UPDATED event.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetBulkStatusRequest,
        description: 'Asset IDs and the new status to apply to all assets.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Status updated for all requested assets.',
        schema: AssetBulkUpdateResponse,
      },
      400: {
        description: 'Request body validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-max-items': 50,
      'x-publishes-event': 'ASSET_UPDATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/bulk-update',
    summary: 'Bulk update assets',
    description:
      'Updates up to 50 assets in the authenticated tenant. Each item is validated and written independently; custom attributes are validated against that asset type and merged into its stored map. Unknown types and invalid attributes return 400. Earlier items may remain committed if a later item fails.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      body: {
        schema: AssetBulkUpdateRequest,
        description: 'Array of asset_id plus partial update data objects.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Assets updated successfully.',
        schema: AssetBulkUpdateResponse,
      },
      400: {
        description: 'Request validation failed, asset_type is not registered, or custom attributes are invalid.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-max-items': 50,
      'x-publishes-event': 'ASSET_UPDATED',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/documents/{associationId}',
    summary: 'Remove asset document association',
    description:
      'Removes a document association row by document_associations.association_id for the authenticated tenant. The service deletes rows where association_id and tenant match and does not verify entity_type in this method. The controller intends to return an empty success response after deletion, but currently calls createApiResponse(null, 204) inside NextResponse.json, which can throw because JSON responses cannot use status 204 with a body.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetDocumentAssociationParams,
    },
    responses: {
      204: {
        description: 'Intended successful deletion response with no body.',
        emptyBody: true,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update asset documents when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including the current 204 JSON response construction issue.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-current-204-json-response-bug': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/export',
    summary: 'Export assets',
    description:
      'Exports all assets for the authenticated tenant (paginated internally, not capped to the default list page). Optional set filters asset_types, statuses, and client_ids narrow the result; fields restricts the exported columns. format=csv (default) returns text/csv with Content-Disposition attachment filename=assets.csv; format=json returns the success envelope with the rows in data. The route is authenticated and tenant-scoped via withApiKeyRouteAuth.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetExportQuery,
    },
    responses: {
      200: {
        description: 'Asset export returned successfully. For format=csv (or omitted) the handler returns text/csv with an attachment filename; for format=json it returns this JSON envelope.',
        schema: AssetExportJsonResponse,
      },
      400: {
        description: 'Query parameter validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing/invalid.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Caller lacks asset:read.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-current-auth-wiring-missing': false,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-csv-content-disposition': 'attachment; filename=assets.csv',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/maintenance/{scheduleId}',
    summary: 'Delete asset maintenance schedule',
    description:
      'Deletes a maintenance schedule by asset_maintenance_schedules.schedule_id for the authenticated tenant. The service scopes deletion by schedule_id and context.tenant and performs no existence check, so missing or cross-tenant IDs are silent no-ops. The controller intends to return 204 with no body, but currently constructs a JSON response with status 204, which can throw in NextResponse.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: MaintenanceScheduleParams,
    },
    responses: {
      204: {
        description: 'Maintenance schedule deleted successfully, or it was already absent.',
        emptyBody: true,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to delete or update asset maintenance schedules when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including the current 204 JSON response construction issue.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'delete',
      'x-idempotent': true,
      'x-no-existence-check': true,
      'x-current-204-json-response-bug': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/maintenance/{scheduleId}',
    summary: 'Update asset maintenance schedule',
    description:
      'Updates existing maintenance schedule columns for the authenticated tenant. All fields are optional; unknown and legacy fields are rejected. Response-only fields (schedule_id, asset_id, tenant, created_by, created_by_name, created_at, updated_at, last_maintenance, archived_at) are accepted and ignored so a row read from GET can be sent back as-is. next_maintenance is explicit: changing frequency alone preserves the current due date. Due-date changes synchronize the open occurrence and unsent notifications. Disabling cancels the open occurrence; re-enabling an unarchived schedule opens one. All writes are transactional. Missing or cross-tenant schedule IDs return 404.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: MaintenanceScheduleParams,
      body: {
        schema: MaintenanceScheduleUpdateRequest,
        description: 'Partial maintenance schedule update data. Response-only fields are ignored; legacy and unknown fields return 400.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Maintenance schedule updated successfully.',
        schema: MaintenanceScheduleResponse,
      },
      400: {
        description: 'Request body validation failed.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update asset maintenance schedules when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      404: {
        description: 'Schedule not found in the authenticated tenant.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-recalculates-next-maintenance': false,
      'x-no-not-found-on-missing-id': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/relationships/{relationshipId}',
    summary: 'Delete asset relationship',
    description:
      'Deletes an asset relationship by asset_relationships.relationship_id for the authenticated tenant. The service hard-deletes rows where relationship_id and context.tenant match, publishes no event, and performs no existence check; missing or cross-tenant IDs are silent no-ops. The controller intends to return 204 with no body, but currently constructs a JSON response with status 204, which can throw in NextResponse.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetRelationshipParams,
    },
    responses: {
      204: {
        description: 'Relationship deleted successfully, or it was already absent.',
        emptyBody: true,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update asset relationships when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including the current 204 JSON response construction issue.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-idempotent': true,
      'x-no-existence-check': true,
      'x-current-204-json-response-bug': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/search',
    summary: 'Search assets',
    description:
      'Searches tenant assets with a required query term and optional field, asset type, status, client, extension-data, and limit parameters. The service searches assets scoped to context.tenant, joins clients for client_name, and optionally loads asset-type-specific extension data per result. The response is not paginated and includes HATEOAS links for each asset; the top-level search link currently points at /api/v2/assets/search.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetSearchQuery,
    },
    responses: {
      200: {
        description: 'Matching assets returned successfully.',
        schema: AssetSearchResponse,
      },
      400: {
        description: 'Query parameter validation failed, including missing required query.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-not-paginated': true,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/stats',
    summary: 'Get asset statistics',
    description:
      'Returns tenant-scoped aggregate asset statistics including total counts, counts by type/status/client, warranty counts, and maintenance due/overdue counts. The service runs multiple aggregate queries filtered by context.tenant; assets_by_client is limited to the top 10 client names. The response links currently point at /api/v2/assets paths.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    responses: {
      200: {
        description: 'Asset statistics returned successfully.',
        schema: AssetStatsResponse,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-assets-by-client-limit': 10,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}',
    summary: 'Get asset details',
    description:
      'Returns detailed asset information for the authenticated tenant, including joined client_name, computed warranty_status, client details, type-specific extension_data, relationships, document associations, maintenance schedules, and HATEOAS links. The service first loads assets by asset_id and context.tenant, then loads related data in parallel. If the asset is not found, the controller returns a 404 error envelope.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
    },
    responses: {
      200: {
        description: 'Asset details returned successfully.',
        schema: AssetResourceResponse,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      404: {
        description: 'No asset exists for the supplied asset_id in the authenticated tenant.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-includes-related-resources': ['client', 'extension_data', 'relationships', 'documents', 'maintenance_schedules'],
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/assets/{id}',
    summary: 'Update asset',
    description:
      'Partially updates base asset fields for the authenticated tenant. Custom attributes are validated against the next asset type when asset_type changes, then merged into the stored map so omitted keys remain. Required custom fields cannot be blanked. Unknown asset_type slugs and invalid attributes return 400.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: {
        schema: AssetUpdateData,
        description: 'Partial base asset update data. Extension data is not accepted by this REST endpoint.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Asset updated successfully.',
        schema: AssetResourceResponse,
      },
      400: {
        description: 'Request validation failed, asset_type is not registered, custom attributes are invalid, or the database rejected an invalid reference.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      404: {
        description: 'Intended not-found response for missing assets; the current controller path may surface this as 500.',
        schema: ApiErrorEnvelope,
      },
      409: {
        description: 'Database unique constraint conflict, such as a duplicate asset tag if enforced by schema.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including null asset result handling.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-publishes-event': 'ASSET_UPDATED',
      'x-extension-data-handled': false,
      'x-history-recorded': false,
      'x-transactional': false,
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/{id}',
    summary: 'Delete asset',
    description:
      'Hard-deletes an asset for the authenticated tenant. AssetService.delete first loads the asset by asset_id and context.tenant, deletes asset-type-specific extension data, deletes tenant_external_entity_mappings for the asset, deletes the assets row, and publishes ASSET_DELETED. The method overrides the BaseService softDelete configuration and does not explicitly clean every related table handled by the server-action delete path. Missing assets throw a generic Error and currently surface as 500 via handleApiError rather than 404. The controller also constructs a JSON response with status 204, which can throw in NextResponse.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
    },
    responses: {
      204: {
        description: 'Asset deleted successfully. Intended response has no body.',
        emptyBody: true,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to delete assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      404: {
        description: 'Intended not-found response for missing assets; the current service throws a generic Error that may surface as 500.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including generic Asset not found errors or the current 204 JSON response construction issue.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'delete',
      'x-hard-delete': true,
      'x-publishes-event': 'ASSET_DELETED',
      'x-current-204-json-response-bug': true,
      'x-no-clean-not-found-currently': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/documents',
    summary: 'List asset document associations',
    description:
      'Returns document_associations rows for an asset in the authenticated tenant where entity_type is asset and entity_id is the path asset ID. The service joins documents to add original_filename, file_size, mime_type, and uploaded_at. It does not check whether the asset exists first, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
    },
    responses: {
      200: {
        description: 'Document associations returned successfully. Empty when no associations exist or the asset is not found.',
        schema: AssetDocumentListResponse,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to read asset documents when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/documents',
    summary: 'Associate document with asset',
    description:
      'Creates a document_associations row that links the path asset ID to the supplied document_id. The body is validated with createAssetDocumentSchema; document_id is required and notes is optional. The service inserts entity_type=asset, entity_id from the path, document_id, notes, tenant from context, and created_at, then returns the inserted row. It does not verify that the asset or document belongs to the same tenant before insert, does not set created_by, and publishes no event. Foreign-key or unique constraint errors surface through handleApiError.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: {
        schema: AssetDocumentAssociationRequest,
        description: 'Document UUID and optional association notes.',
        required: true,
      },
    },
    responses: {
      201: {
        description: 'Document association created successfully.',
        schema: AssetDocumentAssociationResponse,
      },
      400: {
        description: 'Request body validation failed or a database foreign-key reference is invalid.',
        schema: ApiErrorEnvelope,
      },
      401: {
        description: 'x-api-key is missing at middleware.',
        schema: MiddlewareUnauthorizedResponse,
      },
      403: {
        description: 'Authenticated request context lacks permission to update asset documents when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      409: {
        description: 'Duplicate association rejected by a database unique constraint.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-tenant-cross-check-for-document': true,
      'x-created-by-set': false,
      'x-no-event-published': true,
    },
    edition: 'both',
  });


  // ---------------------------------------------------------------------------
  // alga-2026-0002672: assignment history, the status registry and asset groups
  // ---------------------------------------------------------------------------

  const AssetAssignment = registry.registerSchema(
    'AssetAssignment',
    zOpenApi.object({
      assignment_id: zOpenApi.string().guid(),
      asset_id: zOpenApi.string().guid(),
      contact_name_id: zOpenApi.string().guid(),
      contact_name: zOpenApi.string().nullable().optional().describe('Joined from contacts.full_name.'),
      assigned_at: zOpenApi.string().datetime(),
      assigned_by_user_id: zOpenApi.string().guid().nullable().optional(),
      unassigned_at: zOpenApi.string().datetime().nullable().optional().describe('Null while this is the current assignment.'),
      unassigned_by_user_id: zOpenApi.string().guid().nullable().optional(),
      source: zOpenApi.enum(['manual', 'api', 'rmm', 'bundle', 'import', 'merge', 'system']).describe('Where the assignment came from.'),
      note: zOpenApi.string().nullable().optional().describe('For an rmm assignment, the raw signed-in user name.'),
    }),
  );

  const AssetAssignmentListResponse = registry.registerSchema(
    'AssetAssignmentListResponse',
    zOpenApi.object({ data: zOpenApi.array(AssetAssignment) }),
  );

  const AssetStatus = registry.registerSchema(
    'AssetStatus',
    zOpenApi.object({
      status_id: zOpenApi.string().guid(),
      slug: zOpenApi.string().describe('What assets.status stores.'),
      label: zOpenApi.string(),
      kind: zOpenApi.enum(['deployable', 'pending', 'undeployable', 'archived']).describe('Lifecycle bucket; "deployed" metrics use kind = deployable.'),
      is_builtin: zOpenApi.boolean(),
      is_active: zOpenApi.boolean(),
      display_order: zOpenApi.number().int(),
    }),
  );

  const AssetStatusListResponse = registry.registerSchema(
    'AssetStatusListResponse',
    zOpenApi.object({ data: zOpenApi.array(AssetStatus) }),
  );

  const AssetGroup = registry.registerSchema(
    'AssetGroup',
    zOpenApi.object({
      group_id: zOpenApi.string().guid(),
      client_id: zOpenApi.string().guid(),
      name: zOpenApi.string(),
      kind: zOpenApi.enum(['bundle', 'shared_workspace']).describe('A bundle has one owner and moves as a unit; a shared workspace has users and its members carry no single assignee.'),
      location_id: zOpenApi.string().guid().nullable().optional(),
      location_name: zOpenApi.string().nullable().optional(),
      description: zOpenApi.string().nullable().optional(),
      member_count: zOpenApi.number().int().optional(),
      people_count: zOpenApi.number().int().optional(),
      members: zOpenApi.array(zOpenApi.object({
        asset_id: zOpenApi.string().guid(),
        asset_name: zOpenApi.string().nullable().optional(),
        asset_type: zOpenApi.string().nullable().optional(),
        asset_tag: zOpenApi.string().nullable().optional(),
        asset_status: zOpenApi.string().nullable().optional(),
      })).optional(),
      contacts: zOpenApi.array(zOpenApi.object({
        contact_name_id: zOpenApi.string().guid(),
        contact_name: zOpenApi.string().nullable().optional(),
        role: zOpenApi.enum(['owner', 'user']),
      })).optional(),
    }),
  );

  const AssetGroupResponse = registry.registerSchema(
    'AssetGroupResponse',
    zOpenApi.object({ data: AssetGroup }),
  );

  const AssetGroupListResponse = registry.registerSchema(
    'AssetGroupListResponse',
    zOpenApi.object({ data: zOpenApi.array(AssetGroup) }),
  );

  const AssetGroupIdParams = registry.registerSchema(
    'AssetGroupIdParams',
    zOpenApi.object({ id: zOpenApi.string().guid().describe('asset_groups.group_id') }),
  );

  const CreateAssetGroupRequest = registry.registerSchema(
    'CreateAssetGroupRequest',
    zOpenApi.object({
      client_id: zOpenApi.string().guid(),
      name: zOpenApi.string().max(255),
      kind: zOpenApi.enum(['bundle', 'shared_workspace']),
      location_id: zOpenApi.string().guid().nullable().optional(),
      description: zOpenApi.string().nullable().optional(),
      asset_ids: zOpenApi.array(zOpenApi.string().guid()).optional().describe('Members to add in the same transaction.'),
    }),
  );

  const UpdateAssetGroupRequest = registry.registerSchema(
    'UpdateAssetGroupRequest',
    zOpenApi.object({
      name: zOpenApi.string().max(255).optional(),
      kind: zOpenApi.enum(['bundle', 'shared_workspace']).optional().describe('shared_workspace to bundle is refused while users exist; the reverse unassigns every member.'),
      location_id: zOpenApi.string().guid().nullable().optional().describe('Propagates to every member.'),
      description: zOpenApi.string().nullable().optional(),
    }),
  );

  const AssetGroupMembersRequest = registry.registerSchema(
    'AssetGroupMembersRequest',
    zOpenApi.object({ asset_ids: zOpenApi.array(zOpenApi.string().guid()).min(1) }),
  );

  const AssetGroupContactRequest = registry.registerSchema(
    'AssetGroupContactRequest',
    zOpenApi.object({
      contact_name_id: zOpenApi.string().guid().nullable().describe('Null with role owner clears the bundle owner.'),
      role: zOpenApi.enum(['owner', 'user']),
    }),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/assignments',
    summary: 'List asset assignment history',
    description:
      'Returns every assignment of the path asset, newest first, with the contact name joined. An asset that does not exist in the authenticated tenant returns 404 rather than an empty array.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Assignment history returned successfully.', schema: AssetAssignmentListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      404: { description: 'Asset not found in this tenant.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-statuses',
    summary: 'List asset statuses',
    description:
      'Returns the tenant asset status registry in display order. Active statuses only unless include_archived=true. assets.status stores the slug.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: registry.registerSchema(
        'AssetStatusListQuery',
        zOpenApi.object({
          include_archived: zOpenApi.enum(['true', 'false']).optional().describe('true also returns archived (is_active false) statuses.'),
        }),
      ),
    },
    responses: {
      200: { description: 'Asset statuses returned successfully.', schema: AssetStatusListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  // Equipment custody (alga-2026-0002683, C4). No new RBAC resource: asset:read / asset:update plus the record check.
  const CustodyEnvelope = registry.registerSchema(
    'AssetCustodyEnvelope',
    zOpenApi.object({ data: zOpenApi.record(zOpenApi.string(), zOpenApi.any()) }).describe('Custody data wrapped in the standard envelope.'),
  );
  const OpenCustodyRequest = registry.registerSchema(
    'OpenAssetCustodyRequest',
    zOpenApi
      .object({
        ticket_id: zOpenApi.string().guid().nullable().optional().describe('Ticket the equipment was received for; its client must match the asset.'),
        location_id: zOpenApi.string().guid().describe('Active stock location the item is shelved at.'),
        bin: zOpenApi.string().max(64).describe('Free-text bin or shelf label.'),
        purpose: zOpenApi.enum(['repair', 'warranty_evaluation', 'loaner_prep', 'staging']),
        next_action_party: zOpenApi.enum(['msp', 'client', 'vendor']).optional(),
        next_action_note: zOpenApi.string().max(2000).nullable().optional(),
        follow_up_on: zOpenApi.string().describe('Date only, YYYY-MM-DD.').nullable().optional(),
        condition_note: zOpenApi.string().max(2000).nullable().optional(),
      })
      .passthrough(),
  );
  const CustodyEventRequest = registry.registerSchema(
    'AssetCustodyEventRequest',
    zOpenApi
      .object({ event_type: zOpenApi.enum(['moved', 'handed_off', 'shipped', 'received', 'returned']) })
      .passthrough()
      .describe('Fields depend on event_type: moved {location_id?, bin?}, handed_off {to_holder_user_id}, shipped {counterparty}, received {location_id, bin}, returned {counterparty?}.'),
  );

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/custody',
    summary: 'Get asset custody',
    description: 'Returns the open custody episode (if any), the episode history and the append-only event timeline of the asset. An asset the caller cannot read answers 404 with no data.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Custody returned successfully.', schema: CustodyEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      404: { description: 'Asset not found or not readable.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: { ...assetRouteExtensions, 'x-rbac-resource': 'asset', 'x-rbac-action': 'read', 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/custody',
    summary: 'Receive an asset into custody',
    description: 'Opens a custody episode for the asset. Never touches stock, billing or time. 409 when an episode is already open.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams, body: { schema: OpenCustodyRequest, description: 'Where the item is shelved and who acts next.', required: true } },
    responses: {
      201: { description: 'Custody episode opened.', schema: CustodyEnvelope },
      400: { description: 'Validation failed (inactive location, client mismatch, invalid date).', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      404: { description: 'Asset not found or not readable.', schema: ApiErrorEnvelope },
      409: { description: 'An episode is already open for this asset.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: { ...assetRouteExtensions, 'x-rbac-resource': 'asset', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/custody/events',
    summary: 'Record a custody step',
    description: 'Appends a moved, handed_off, shipped, received or returned step to the asset\u2019s open episode. Invalid transitions answer 409.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams, body: { schema: CustodyEventRequest, description: 'The step to record.', required: true } },
    responses: {
      201: { description: 'Step recorded.', schema: CustodyEnvelope },
      400: { description: 'Validation failed.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      404: { description: 'Asset not found or not readable.', schema: ApiErrorEnvelope },
      409: { description: 'The asset is not in custody, or the step is not allowed from the current state.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: { ...assetRouteExtensions, 'x-rbac-resource': 'asset', 'x-rbac-action': 'update' },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-custody',
    summary: 'List equipment in custody',
    description: 'The custody queue. Rows and tab counts exclude assets the caller cannot read.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: registry.registerSchema(
        'AssetCustodyQueueQuery',
        zOpenApi.object({
          tab: zOpenApi.string().optional(),
          client_id: zOpenApi.string().guid().optional(),
          location_id: zOpenApi.string().guid().optional(),
          holder_user_id: zOpenApi.string().guid().optional(),
          purpose: zOpenApi.enum(['repair', 'warranty_evaluation', 'loaner_prep', 'staging']),
          next_action_party: zOpenApi.enum(['msp', 'client', 'vendor']).optional(),
          mine: zOpenApi.enum(['true', 'false']).optional(),
          page: zOpenApi.string().optional(),
          pageSize: zOpenApi.string().optional(),
        }),
      ),
    },
    responses: {
      200: { description: 'Queue returned successfully.', schema: CustodyEnvelope },
      400: { description: 'Invalid filter.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: { ...assetRouteExtensions, 'x-rbac-resource': 'asset', 'x-rbac-action': 'read', 'x-no-asset-existence-check': true, 'x-not-paginated': true },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-groups',
    summary: 'List asset groups for a client',
    description: 'Returns the client\u2019s bundles and shared workspaces with member and people counts. client_id is required.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: registry.registerSchema(
        'AssetGroupListQuery',
        zOpenApi.object({ client_id: zOpenApi.string().guid().describe('Required; groups belong to a client.') }),
      ),
    },
    responses: {
      200: { description: 'Asset groups returned successfully.', schema: AssetGroupListResponse },
      400: { description: 'client_id is missing or not a UUID.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-groups',
    summary: 'Create an asset group',
    description:
      'Creates a bundle or shared workspace for a client, optionally with its first members. Adding a member to a bundle assigns it to the owner and moves it to the group location; adding one to a shared workspace unassigns it.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { body: { schema: CreateAssetGroupRequest, description: 'Group to create, optionally with its first members.', required: true } },
    responses: {
      200: { description: 'Asset group created successfully.', schema: AssetGroupResponse },
      400: { description: 'Validation failed, or a group invariant was violated (client mismatch, asset already grouped).', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/asset-groups/{id}',
    summary: 'Get an asset group',
    description: 'Returns the group with its members and people.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetGroupIdParams },
    responses: {
      200: { description: 'Asset group returned successfully.', schema: AssetGroupResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset read permission.', schema: ApiErrorEnvelope },
      404: { description: 'Asset group not found in this tenant.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'put',
    path: '/api/v1/asset-groups/{id}',
    summary: 'Update an asset group',
    description:
      'Renames the group, changes its kind or moves its location. A location change moves every member. shared_workspace to bundle is refused while users exist; bundle to shared_workspace unassigns every member and drops the owner.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetGroupIdParams,
      body: { schema: UpdateAssetGroupRequest, description: 'Fields to change.', required: true },
    },
    responses: {
      200: { description: 'Asset group updated successfully.', schema: AssetGroupResponse },
      400: { description: 'Validation failed or a group invariant was violated.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/asset-groups/{id}',
    summary: 'Delete an asset group',
    description: 'Deletes the group and its member and people rows. Members keep their current assignee and location.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetGroupIdParams },
    responses: {
      200: { description: 'Asset group deleted successfully.', schema: registry.registerSchema('AssetGroupDeleteResponse', zOpenApi.object({ data: zOpenApi.object({ success: zOpenApi.boolean() }) })) },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-groups/{id}/members',
    summary: 'Add assets to a group',
    description:
      'Adds members. For a bundle each new member is assigned to the owner and moved to the group location; for a shared workspace each is unassigned. An asset of another client or already in another group is a 400.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetGroupIdParams,
      body: { schema: AssetGroupMembersRequest, description: 'Assets to add as members.', required: true },
    },
    responses: {
      200: { description: 'Members added successfully.', schema: AssetGroupResponse },
      400: { description: 'Validation failed or a group invariant was violated.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/asset-groups/{id}/members',
    summary: 'Remove an asset from a group',
    description: 'Removes the asset named by asset_id. Its assignee and location are left as they are.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetGroupIdParams,
      query: registry.registerSchema(
        'AssetGroupMemberQuery',
        zOpenApi.object({ asset_id: zOpenApi.string().guid().describe('Required.') }),
      ),
    },
    responses: {
      200: { description: 'Member removed successfully.', schema: AssetGroupResponse },
      400: { description: 'asset_id is missing or not a UUID.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/asset-groups/{id}/contacts',
    summary: 'Set a group owner or add a workspace user',
    description:
      'With role owner, sets (or with a null contact clears) the bundle owner, which assigns or unassigns every member. With role user, adds a shared-workspace user. A user on a bundle or an owner on a workspace is a 400.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetGroupIdParams,
      body: { schema: AssetGroupContactRequest, description: 'The contact and the role to give them.', required: true },
    },
    responses: {
      200: { description: 'Group people updated successfully.', schema: AssetGroupResponse },
      400: { description: 'Validation failed or a group invariant was violated.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/asset-groups/{id}/contacts',
    summary: 'Remove a group owner or workspace user',
    description: 'Removes the contact named by contact_name_id. On a bundle this clears the owner, which unassigns every member.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetGroupIdParams,
      query: registry.registerSchema(
        'AssetGroupContactQuery',
        zOpenApi.object({ contact_name_id: zOpenApi.string().guid().describe('Required.') }),
      ),
    },
    responses: {
      200: { description: 'Group people updated successfully.', schema: AssetGroupResponse },
      400: { description: 'contact_name_id is missing or not a UUID.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset update permission.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/history',
    summary: 'List asset maintenance history',
    description:
      'Returns all maintenance history rows for the path asset ID in the authenticated tenant, ordered by performed_at descending. The service joins users to add performed_by_user_name and filters asset_maintenance_history by asset_id and context.tenant. It performs no asset existence check, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Maintenance history rows returned successfully.', schema: MaintenanceHistoryResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset history when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-not-paginated': true,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/maintenance',
    summary: 'List asset maintenance schedules',
    description:
      'Returns maintenance schedule rows using the existing UI/database columns for the path asset ID in the authenticated tenant. The service filters asset_maintenance_schedules by asset_id and context.tenant and joins users to add created_by_name. It performs no asset existence check, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Maintenance schedules returned successfully.', schema: MaintenanceScheduleListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset maintenance schedules when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/maintenance',
    summary: 'Create asset maintenance schedule',
    description:
      'Creates a maintenance schedule using the existing UI/database columns: schedule_name, description, maintenance_type, frequency, frequency_interval, schedule_config, next_maintenance, and is_active. The asset must belong to the authenticated tenant. asset_id comes from the path; tenant and created_by come from authentication. next_maintenance is stored unchanged. The schedule, upcoming notification, and initial open occurrence (if active) are created in one transaction. Legacy schedule_type, notes, start_date, end_date, and assigned_to fields are rejected. No database migration is required.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: { schema: MaintenanceScheduleCreateRequest, description: 'Maintenance schedule creation data.', required: true },
    },
    responses: {
      201: { description: 'Maintenance schedule created successfully.', schema: MaintenanceScheduleResponse },
      400: { description: 'Request body validation failed or the database rejected an invalid reference.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to create or update asset maintenance schedules when auth wiring is present.', schema: ApiErrorEnvelope },
      404: { description: 'Asset not found in the authenticated tenant.', schema: ApiErrorEnvelope },
      409: { description: 'Database unique constraint conflict if one is enforced.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': false,
      'x-calculates-next-maintenance': false,
      'x-created-by-set': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/maintenance/record',
    summary: 'Record asset maintenance',
    description:
      'Inserts an asset_maintenance_history row for the path asset ID in the authenticated tenant. The request body requires maintenance_type, performed_by, and performed_at; schedule_id, duration, cost, notes, parts, and structured maintenance_data are optional. If schedule_id is supplied and a matching tenant schedule exists, the service updates that schedule last_maintenance and next_maintenance. It does not verify asset existence or performed_by before insert, does not set created_by, and publishes no event.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: { schema: RecordMaintenanceRequest, description: 'Maintenance history record data.', required: true },
    },
    responses: {
      201: { description: 'Maintenance record created successfully.', schema: RecordMaintenanceResponse },
      400: { description: 'Request body validation failed or the database rejected an invalid reference.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to update asset maintenance records when auth wiring is present.', schema: ApiErrorEnvelope },
      409: { description: 'Database unique constraint conflict if one is enforced.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-performed-by-not-validated': true,
      'x-schedule-update-on-linked': true,
      'x-created-by-set': false,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/relationships',
    summary: 'List asset relationships',
    description:
      'Returns asset_relationships rows for the path asset ID in the authenticated tenant, joined with the related assets table for display fields. The service filters by asset_relationships.asset_id and context.tenant and joins related assets on matching tenant. It performs no parent asset existence check and does not filter soft-deleted related assets. Response links currently point at /api/v2/assets paths.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Asset relationships returned successfully.', schema: AssetRelationshipListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset relationships when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-no-asset-existence-check': true,
      'x-related-asset-soft-delete-filter': false,
      'x-response-links-path-version': 'v2',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/relationships',
    summary: 'Create asset relationship',
    description:
      'Creates a relationship row between the path asset ID and related_asset_id for the authenticated tenant. The request body requires related_asset_id and non-empty relationship_type. The service rejects self relationships and duplicate source/related pairs, but currently throws generic Errors for those cases, which surface as 500 rather than 400 or 409. The inserted row is returned without joined related asset details.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: { schema: AssetRelationshipCreateRequest, description: 'Relationship creation data.', required: true },
    },
    responses: {
      201: { description: 'Asset relationship created successfully.', schema: AssetRelationshipResponse },
      400: { description: 'Request body validation failed or a database reference is invalid.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to update asset relationships when auth wiring is present.', schema: ApiErrorEnvelope },
      409: { description: 'Intended duplicate conflict response; current duplicate check throws a generic Error that may surface as 500.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error, including self-relationship or duplicate-relationship errors in the current implementation.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-self-relationship-check': true,
      'x-duplicate-check': true,
      'x-self-relationship-error-is-500': true,
      'x-duplicate-error-is-500': true,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/tickets',
    operationId: 'listAssetTickets',
    summary: 'List tickets linked to an asset',
    description:
      'Returns tickets associated with the path asset ID in the authenticated tenant, read from asset_associations where entity_type is ticket, joined to tickets and statuses. Results include the association relationship_type and linked_at and are ordered by ticket updated_at descending. This mirrors the asset detail UI and the assets.find_associated_tickets workflow action. The route is authenticated and tenant-scoped via withApiKeyRouteAuth (req.context is populated and RLS is active) and enforces BOTH asset:read and ticket:read because the response joins ticket data. It performs no asset existence check, so a valid caller hitting a nonexistent or cross-tenant asset ID gets 200 with an empty array (tenant scoping prevents cross-tenant leakage; this is not an authorization bypass).',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Linked tickets returned successfully. Empty when no associations exist or the asset is not found.', schema: AssetTicketListResponse },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset:read or ticket:read.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-current-auth-wiring-missing': false,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-rbac-additional-required': 'ticket:read',
      'x-no-asset-existence-check': true,
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'get',
    path: '/api/v1/tickets/{id}/assets',
    operationId: 'listTicketAssets',
    summary: 'List assets linked to a ticket',
    description:
      'Returns assets associated with the path ticket ID in the authenticated tenant, read from asset_associations where entity_type is ticket, joined to assets and clients. Each row includes the asset fields plus the association relationship_type, association_notes, and linked_at, ordered by link time descending. The route is authenticated and tenant-scoped via ApiBaseController.authenticate + runWithTenant (RLS active); it enforces ticket:read, a per-ticket authorization-kernel check (assertTicketReadAllowed), AND asset:read because the response exposes asset records. The response uses the apiMiddleware envelope ({ data } with no top-level success field). It performs no asset existence check beyond the ticket authorization, so an authorized caller on a ticket with no linked assets gets 200 with an empty array.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Linked assets returned successfully. Empty when the ticket has no linked assets.', schema: TicketAssetListResponse },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks ticket:read (or per-ticket authorization) or asset:read.', schema: ApiErrorEnvelope },
      404: { description: 'Ticket not found / not authorized for the caller.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-rbac-resource': 'ticket',
      'x-rbac-action': 'read',
      'x-rbac-additional-required': 'asset:read',
      'x-per-record-authorization': 'assertTicketReadAllowed',
      'x-not-paginated': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/tickets',
    operationId: 'linkTicketToAsset',
    summary: 'Link a ticket to an asset',
    description:
      'Creates an asset_associations row (entity_type=ticket) linking the path asset to the ticket in the request body. This is the same table the asset detail UI, GET /api/v1/assets/{id}/tickets, and GET /api/v1/tickets/{id}/assets read, so the link is immediately visible from both sides. relationship_type defaults to affected. The route is authenticated and tenant-scoped via withApiKeyRouteAuth and enforces asset:update (the asset associations are being mutated) plus ticket:read (the ticket is only referenced). Both the asset and the ticket must exist in the tenant (404 otherwise), and a duplicate link returns 409.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: {
        schema: AssetTicketLinkRequest,
        description: 'The ticket to link plus optional relationship_type and notes.',
        required: true,
      },
    },
    responses: {
      201: { description: 'Ticket linked. Returns the inserted asset_associations row.', schema: AssetTicketLinkResponse },
      400: { description: 'Request body validation failed.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset:update or ticket:read.', schema: ApiErrorEnvelope },
      404: { description: 'Asset or ticket not found in the tenant.', schema: ApiErrorEnvelope },
      409: { description: 'Ticket is already linked to this asset.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-current-auth-wiring-missing': false,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-rbac-additional-required': 'ticket:read',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/{id}/tickets/{ticketId}',
    operationId: 'unlinkTicketFromAsset',
    summary: 'Unlink a ticket from an asset',
    description:
      'Deletes the asset_associations row (entity_type=ticket) linking the path asset and ticket for the authenticated tenant. The route is authenticated and tenant-scoped via withApiKeyRouteAuth and enforces asset:update plus ticket:read. Returns 404 when no such link exists.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetTicketLinkParams },
    responses: {
      204: { description: 'Link removed.', emptyBody: true },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks asset:update or ticket:read.', schema: ApiErrorEnvelope },
      404: { description: 'Asset-ticket association not found.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-current-auth-wiring-missing': false,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-rbac-additional-required': 'ticket:read',
      'x-idempotent': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/tickets/{id}/assets',
    operationId: 'linkAssetToTicket',
    summary: 'Link an asset to a ticket',
    description:
      'Creates an asset_associations row (entity_type=ticket) linking the asset in the request body to the path ticket. Same table GET /api/v1/tickets/{id}/assets and the asset detail UI read, so the link is visible from both sides. relationship_type defaults to affected. The route is authenticated and tenant-scoped via ApiBaseController.authenticate + runWithTenant; it enforces ticket:update plus a per-ticket authorization-kernel check (assertTicketReadAllowed) AND asset:read (the asset is referenced). The response uses the apiMiddleware envelope ({ data } with no top-level success field). Both the ticket and asset must exist (404 otherwise); a duplicate link returns 409.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: AssetIdParams,
      body: {
        schema: TicketAssetLinkRequest,
        description: 'The asset to link plus optional relationship_type and notes.',
        required: true,
      },
    },
    responses: {
      201: { description: 'Asset linked. Returns the inserted asset_associations row.', schema: TicketAssetLinkResponse },
      400: { description: 'Request body validation failed.', schema: ApiErrorEnvelope },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks ticket:update (or per-ticket authorization) or asset:read.', schema: ApiErrorEnvelope },
      404: { description: 'Ticket or asset not found in the tenant.', schema: ApiErrorEnvelope },
      409: { description: 'Asset is already linked to this ticket.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-rbac-resource': 'ticket',
      'x-rbac-action': 'update',
      'x-rbac-additional-required': 'asset:read',
      'x-per-record-authorization': 'assertTicketReadAllowed',
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/tickets/{id}/assets/{assetId}',
    operationId: 'unlinkAssetFromTicket',
    summary: 'Unlink an asset from a ticket',
    description:
      'Deletes the asset_associations row (entity_type=ticket) linking the path asset and ticket for the authenticated tenant. Authenticated and tenant-scoped via ApiBaseController.authenticate + runWithTenant; enforces ticket:update plus the per-ticket authorization check and asset:read. Returns 404 when no such link exists.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: TicketAssetLinkParams },
    responses: {
      204: { description: 'Link removed.', emptyBody: true },
      401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Caller lacks ticket:update (or per-ticket authorization) or asset:read.', schema: ApiErrorEnvelope },
      404: { description: 'Asset-ticket association not found.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
    },
    extensions: {
      'x-tenant-scoped': true,
      'x-request-context-required': true,
      'x-rbac-resource': 'ticket',
      'x-rbac-action': 'update',
      'x-rbac-additional-required': 'asset:read',
      'x-per-record-authorization': 'assertTicketReadAllowed',
      'x-idempotent': false,
    },
    edition: 'both',
  });

  // ==========================================================================
  // Asset sub-resources: notes, RMM actions, software inventory, summary
  // ==========================================================================
  const AssetNotesResponse = registry.registerSchema(
    'AssetNotesResponse',
    zOpenApi.object({
      document: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().optional(),
      blockData: zOpenApi.unknown().nullable().optional().describe('Parsed BlockNote JSON, or null when no notes exist.'),
      lastUpdated: zOpenApi.string().nullable().optional(),
    }),
  );
  const AssetNotesUpdateBody = registry.registerSchema(
    'AssetNotesUpdateBody',
    zOpenApi.object({ blockData: zOpenApi.unknown().describe('BlockNote JSON block data to store as the asset notes.') }),
  );
  const AssetRmmResponse = registry.registerSchema(
    'AssetRmmResponse',
    zOpenApi.object({ data: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).nullable().describe('Cached RMM device data, or null (always null on Community Edition).') }),
  );
  const AssetRmmActionResponse = registry.registerSchema(
    'AssetRmmActionResponse',
    zOpenApi.object({
      success: zOpenApi.boolean(),
      message: zOpenApi.string(),
      jobId: zOpenApi.string().optional().describe('Provider job id when the action was queued (EE).'),
    }),
  );
  const AssetRemoteControlResponse = registry.registerSchema(
    'AssetRemoteControlResponse',
    zOpenApi.object({
      url: zOpenApi.string().optional(),
      type: zOpenApi.string().optional(),
    }).nullable().describe('Remote-control session URL, or null when unavailable (always null on Community Edition).'),
  );
  const AssetRmmScriptBody = registry.registerSchema(
    'AssetRmmScriptBody',
    zOpenApi.object({ scriptId: zOpenApi.string().describe('Provider script identifier to run on the device.') }),
  );
  const AssetRemoteControlQuery = registry.registerSchema(
    'AssetRemoteControlQuery',
    zOpenApi.object({ type: zOpenApi.enum(['splashtop', 'teamviewer', 'vnc', 'rdp', 'shell']).optional().describe('Remote-control protocol (default splashtop).') }),
  );
  const AssetSoftwareQuery = registry.registerSchema(
    'AssetSoftwareQuery',
    zOpenApi.object({
      page: zOpenApi.number().int().min(1).optional(),
      limit: zOpenApi.number().int().min(1).max(200).optional(),
      category: zOpenApi.string().optional(),
      software_type: zOpenApi.string().optional(),
      search: zOpenApi.string().optional(),
      include_uninstalled: zOpenApi.enum(['true', 'false']).optional(),
    }),
  );
  const AssetSoftwareResponse = registry.registerSchema(
    'AssetSoftwareResponse',
    zOpenApi.object({
      data: zOpenApi.array(zOpenApi.record(zOpenApi.string(), zOpenApi.unknown())),
      summary: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
      pagination: zOpenApi.record(zOpenApi.string(), zOpenApi.unknown()).optional(),
    }),
  );
  const AssetSummaryResponse = registry.registerSchema(
    'AssetSummaryResponse',
    zOpenApi.object({
      health_status: zOpenApi.enum(['healthy', 'warning', 'critical', 'unknown']).optional(),
      health_reason: zOpenApi.string().optional(),
      security_status: zOpenApi.enum(['secure', 'at_risk', 'critical']).optional(),
      security_issues: zOpenApi.array(zOpenApi.string()).optional(),
      warranty_status: zOpenApi.enum(['no_warranty', 'expired', 'expiring_soon', 'active']).optional(),
      warranty_days_remaining: zOpenApi.number().nullable().optional(),
      open_tickets_count: zOpenApi.number().optional(),
    }),
  );

  const assetSubErrs = {
    401: { description: 'x-api-key missing/invalid.', schema: MiddlewareUnauthorizedResponse },
    403: { description: 'Caller lacks the required asset permission.', schema: ApiErrorEnvelope },
    404: { description: 'Asset not found.', schema: ApiErrorEnvelope },
    500: { description: 'Unexpected error.', schema: ApiErrorEnvelope },
  };
  const assetExt = (action: string, extra: Record<string, unknown> = {}) => ({
    'x-tenant-scoped': true,
    'x-rbac-resource': 'asset',
    'x-rbac-action': action,
    ...extra,
  });
  // RMM device actions are gated to Enterprise Edition: on Community Edition the
  // handlers return null / { success:false, message:'…requires Enterprise Edition' }.
  const EE_RMM = { 'x-edition-feature': 'ee-rmm', 'x-ce-behavior': 'returns null or success:false EE-required message' };

  registry.registerRoute({
    method: 'get', path: '/api/v1/assets/{id}/notes',
    summary: 'Get asset notes',
    description: 'Returns the BlockNote content of the asset notes document, or an empty result when no notes exist.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams },
    responses: { 200: { description: 'Asset notes content.', schema: AssetNotesResponse }, ...assetSubErrs },
    extensions: assetExt('read'), edition: 'both',
  });
  registry.registerRoute({
    method: 'put', path: '/api/v1/assets/{id}/notes',
    summary: 'Update asset notes',
    description: 'Creates or updates the BlockNote notes document linked to the asset. Returns the document id.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams, body: { schema: AssetNotesUpdateBody } },
    responses: { 200: { description: 'Notes saved.', schema: zOpenApi.object({ document_id: zOpenApi.string().guid() }) }, ...assetSubErrs },
    extensions: assetExt('update'), edition: 'both',
  });
  registry.registerRoute({
    method: 'delete', path: '/api/v1/assets/{id}/notes',
    summary: 'Delete asset notes',
    description: 'Unlinks the notes document from the asset. Pass delete_document=true to also hard-delete the document and its block content.',
    tags: [tag], security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams, query: zOpenApi.object({ delete_document: zOpenApi.enum(['true', 'false']).optional() }) },
    responses: { 204: { description: 'Notes unlinked/deleted.', emptyBody: true }, ...assetSubErrs },
    extensions: assetExt('update'), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/assets/{id}/rmm',
    summary: 'Get cached RMM data',
    description: 'Returns the cached RMM device data synced from the RMM provider. Enterprise Edition feature — on Community Edition this returns null.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams },
    responses: { 200: { description: 'Cached RMM data (null on CE).', schema: AssetRmmResponse }, ...assetSubErrs },
    extensions: assetExt('read', EE_RMM), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/assets/{id}/rmm/reboot',
    summary: 'Reboot device via RMM',
    description: 'Sends a reboot command to the RMM-managed device. Enterprise Edition feature — on Community Edition this returns { success:false } with an EE-required message.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams },
    responses: { 200: { description: 'Reboot result.', schema: AssetRmmActionResponse }, ...assetSubErrs },
    extensions: assetExt('update', EE_RMM), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/assets/{id}/rmm/refresh',
    summary: 'Refresh RMM data for device',
    description: 'Triggers a single-device RMM sync and returns the refreshed data. Enterprise Edition feature — on Community Edition this returns null.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams },
    responses: { 200: { description: 'Refreshed RMM data (null on CE).', schema: AssetRmmResponse }, ...assetSubErrs },
    extensions: assetExt('update', EE_RMM), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/assets/{id}/rmm/remote-control',
    summary: 'Get remote-control session URL',
    description: 'Generates a remote-control URL for the device using the protocol given by the type query param. Enterprise Edition feature — on Community Edition this returns null.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams, query: AssetRemoteControlQuery },
    responses: { 200: { description: 'Remote-control URL (null on CE).', schema: AssetRemoteControlResponse }, ...assetSubErrs },
    extensions: assetExt('read', EE_RMM), edition: 'both',
  });
  registry.registerRoute({
    method: 'post', path: '/api/v1/assets/{id}/rmm/script',
    summary: 'Run a script via RMM',
    description: 'Runs the script identified by scriptId on the RMM-managed device. Enterprise Edition feature — on Community Edition this returns { success:false } with an EE-required message.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams, body: { schema: AssetRmmScriptBody } },
    responses: { 200: { description: 'Script run result.', schema: AssetRmmActionResponse }, ...assetSubErrs },
    extensions: assetExt('update', EE_RMM), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/assets/{id}/software',
    summary: 'List asset software inventory',
    description: 'Returns the paginated software inventory for the asset (from the normalized software tables), with filters for category, software_type, search, and include_uninstalled, plus a summary of totals.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams, query: AssetSoftwareQuery },
    responses: { 200: { description: 'Asset software inventory.', schema: AssetSoftwareResponse }, ...assetSubErrs },
    extensions: assetExt('read'), edition: 'both',
  });
  registry.registerRoute({
    method: 'get', path: '/api/v1/assets/{id}/summary',
    summary: 'Get asset summary metrics',
    description: 'Returns computed asset metrics: health status/reason, security status/issues, warranty status and days remaining, and open ticket count.',
    tags: [tag], security: [{ ApiKeyAuth: [] }], request: { params: AssetIdParams },
    responses: { 200: { description: 'Asset summary metrics.', schema: AssetSummaryResponse }, ...assetSubErrs },
    extensions: assetExt('read'), edition: 'both',
  });

}
