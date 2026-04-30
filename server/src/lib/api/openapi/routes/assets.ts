import { ApiOpenApiRegistry, zOpenApi } from '../registry';

export function registerAssetRoutes(registry: ApiOpenApiRegistry) {
  const tag = 'Assets';

  const AssetType = zOpenApi.enum(['workstation', 'network_device', 'server', 'mobile_device', 'printer', 'unknown']);

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
      client_id: zOpenApi.string().uuid().optional().describe('Client UUID from clients.client_id.'),
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
      format: zOpenApi.enum(['csv', 'json', 'xlsx']).optional().describe('Export format. csv returns text/csv; json and xlsx currently return the same JSON envelope.'),
      include_extension_data: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      include_maintenance: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      include_documents: zOpenApi.enum(['true', 'false']).optional().describe('Accepted by validation, but currently ignored by ApiAssetController.export.'),
      asset_types: zOpenApi.array(AssetType).optional().describe('Accepted by validation as an array, but the controller builds query values with Object.fromEntries and does not apply this filter.'),
      statuses: zOpenApi.array(zOpenApi.string()).optional().describe('Accepted by validation as an array, but not currently applied.'),
      client_ids: zOpenApi.array(zOpenApi.string().uuid()).optional().describe('Accepted by validation as an array, but not currently applied.'),
      fields: zOpenApi.array(zOpenApi.string()).optional().describe('Accepted by validation as an array, but not currently used to select export columns.'),
    }),
  );

  const AssetIdParams = registry.registerSchema(
    'AssetIdParams',
    zOpenApi.object({
      id: zOpenApi.string().uuid().describe('Asset UUID from assets.asset_id.'),
    }),
  );

  const AssetDocumentAssociationParams = registry.registerSchema(
    'AssetDocumentAssociationParams',
    zOpenApi.object({
      associationId: zOpenApi.string().uuid().describe('Document association UUID from document_associations.association_id.'),
    }),
  );

  const AssetDocumentAssociationRequest = registry.registerSchema(
    'AssetDocumentAssociationRequest',
    zOpenApi.object({
      document_id: zOpenApi.string().uuid().describe('Document UUID from documents.document_id to associate with the asset.'),
      notes: zOpenApi.string().optional().describe('Optional notes stored on document_associations.notes.'),
    }),
  );

  const AssetExtensionData = registry.registerSchema(
    'AssetExtensionData',
    zOpenApi.record(zOpenApi.unknown()).describe('Asset-type-specific extension data written to the corresponding extension table for workstation, network device, server, mobile device, or printer assets.'),
  );

  const AssetCreateRequest = registry.registerSchema(
    'AssetCreateRequest',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().describe('Client UUID from clients.client_id. Required.'),
      asset_type: AssetType.describe('Asset type. Determines the optional extension data table.'),
      asset_tag: zOpenApi.string().min(1).max(255).describe('Required tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).describe('Required asset name.'),
      status: zOpenApi.string().min(1).describe('Required asset status.'),
      location: zOpenApi.string().optional().describe('Optional asset location.'),
      serial_number: zOpenApi.string().optional().describe('Optional serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Optional purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Optional warranty end date/time.'),
      extension_data: AssetExtensionData.optional(),
    }),
  );

  const AssetUpdateData = registry.registerSchema(
    'AssetUpdateData',
    zOpenApi.object({
      client_id: zOpenApi.string().uuid().optional().describe('Client UUID to assign to the asset.'),
      asset_type: AssetType.optional().describe('Asset type to store in assets.asset_type.'),
      asset_tag: zOpenApi.string().min(1).max(255).optional().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().min(1).max(255).optional().describe('Asset name.'),
      status: zOpenApi.string().min(1).optional().describe('Asset status.'),
      location: zOpenApi.string().optional().describe('Asset location.'),
      serial_number: zOpenApi.string().optional().describe('Serial number.'),
      purchase_date: zOpenApi.string().datetime().optional().describe('Purchase date/time.'),
      warranty_end_date: zOpenApi.string().datetime().optional().describe('Warranty end date/time.'),
    }),
  );

  const AssetBulkUpdateRequest = registry.registerSchema(
    'AssetBulkUpdateRequest',
    zOpenApi.object({
      assets: zOpenApi.array(zOpenApi.object({
        asset_id: zOpenApi.string().uuid().describe('Asset UUID from assets.asset_id.'),
        data: AssetUpdateData.describe('Partial update data validated with updateAssetSchema.'),
      })).min(1).max(50).describe('Assets to update. Limited to 1 through 50 entries by validation.'),
    }),
  );

  const AssetBulkStatusRequest = registry.registerSchema(
    'AssetBulkStatusRequest',
    zOpenApi.object({
      asset_ids: zOpenApi.array(zOpenApi.string().uuid()).min(1).max(50).describe('Asset UUIDs from assets.asset_id. Limited to 1 through 50 entries by validation.'),
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
      association_id: zOpenApi.string().uuid().describe('Primary key from document_associations.association_id.'),
      entity_type: zOpenApi.literal('asset').describe('Entity type stored on document_associations; always asset for these routes.'),
      entity_id: zOpenApi.string().uuid().describe('Asset UUID from document_associations.entity_id.'),
      document_id: zOpenApi.string().uuid().describe('Document UUID from document_associations.document_id.'),
      notes: zOpenApi.string().nullable().optional().describe('Optional association notes.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID from document_associations.tenant.'),
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
      asset_id: zOpenApi.string().uuid().describe('Primary key from assets.asset_id.'),
      client_id: zOpenApi.string().uuid().describe('Client UUID from assets.client_id.'),
      asset_type: AssetType.describe('Asset type stored in assets.asset_type.'),
      asset_tag: zOpenApi.string().describe('Tenant-specific asset tag.'),
      name: zOpenApi.string().describe('Asset display name.'),
      status: zOpenApi.string().describe('Asset status.'),
      location: zOpenApi.string().nullable().optional().describe('Asset location, when recorded.'),
      serial_number: zOpenApi.string().nullable().optional().describe('Asset serial number, when recorded.'),
      purchase_date: zOpenApi.string().nullable().optional().describe('Asset purchase date from assets.purchase_date.'),
      warranty_end_date: zOpenApi.string().nullable().optional().describe('Warranty end date from assets.warranty_end_date.'),
      created_at: zOpenApi.string().datetime().describe('Asset creation timestamp.'),
      updated_at: zOpenApi.string().datetime().describe('Asset last update timestamp.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID from assets.tenant; filtered to the authenticated request context.'),
      client_name: zOpenApi.string().optional().describe('Client name selected from the joined clients table.'),
      warranty_status: zOpenApi.enum(['no_warranty', 'expired', 'expiring_soon', 'active']).optional().describe('Computed from warranty_end_date by SQL CASE expression.'),
      maintenance_status: zOpenApi.string().optional().describe('Optional computed maintenance status when present in service results.'),
      extension_data: AssetExtensionData.nullable().optional().describe('Asset-type-specific extension data returned by getWithDetails after create.'),
      relationships: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Related asset rows included by getWithDetails after create.'),
      documents: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Associated document rows included by getWithDetails after create.'),
      maintenance_schedules: zOpenApi.array(zOpenApi.record(zOpenApi.unknown())).optional().describe('Maintenance schedule rows included by getWithDetails after create.'),
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
      scheduleId: zOpenApi.string().uuid().describe('Maintenance schedule UUID from asset_maintenance_schedules.schedule_id.'),
    }),
  );

  const AssetRelationshipParams = registry.registerSchema(
    'AssetRelationshipParams',
    zOpenApi.object({
      relationshipId: zOpenApi.string().uuid().describe('Asset relationship UUID from asset_relationships.relationship_id.'),
    }),
  );

  const MaintenanceScheduleUpdateRequest = registry.registerSchema(
    'AssetMaintenanceScheduleUpdateRequest',
    zOpenApi.object({
      schedule_type: zOpenApi.enum(['preventive', 'inspection', 'calibration', 'replacement']).optional().describe('Type of maintenance schedule.'),
      frequency: zOpenApi.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).optional().describe('Recurrence frequency. Changing this triggers next_maintenance recalculation.'),
      frequency_interval: zOpenApi.number().min(1).optional().describe('Frequency multiplier used when calculating the next maintenance date.'),
      start_date: zOpenApi.string().datetime().optional().describe('Schedule start date/time. Changing this triggers next_maintenance recalculation.'),
      end_date: zOpenApi.string().datetime().optional().describe('Optional schedule end date/time.'),
      notes: zOpenApi.string().optional().describe('Free-text schedule notes.'),
      assigned_to: zOpenApi.string().uuid().optional().describe('Assigned user UUID from users.user_id.'),
      is_active: zOpenApi.boolean().optional().describe('Whether the schedule is active.'),
      schedule_config: zOpenApi.record(zOpenApi.unknown()).optional().describe('Custom scheduling configuration.'),
    }),
  );

  const MaintenanceScheduleResource = registry.registerSchema(
    'AssetMaintenanceScheduleResource',
    zOpenApi.object({
      schedule_id: zOpenApi.string().uuid().describe('Primary key from asset_maintenance_schedules.schedule_id.'),
      asset_id: zOpenApi.string().uuid().describe('Asset UUID from asset_maintenance_schedules.asset_id.'),
      schedule_type: zOpenApi.string().optional().describe('Maintenance schedule type as used by ApiAssetController.'),
      frequency: zOpenApi.string().optional().describe('Recurrence frequency.'),
      frequency_interval: zOpenApi.number().nullable().optional().describe('Frequency multiplier.'),
      start_date: zOpenApi.string().nullable().optional().describe('Schedule start date/time.'),
      end_date: zOpenApi.string().nullable().optional().describe('Schedule end date/time.'),
      last_maintenance: zOpenApi.string().nullable().optional().describe('Last recorded maintenance date/time.'),
      next_maintenance: zOpenApi.string().nullable().optional().describe('Next calculated maintenance date/time.'),
      notes: zOpenApi.string().nullable().optional().describe('Free-text schedule notes.'),
      assigned_to: zOpenApi.string().uuid().nullable().optional().describe('Assigned user UUID.'),
      is_active: zOpenApi.boolean().optional().describe('Whether the schedule is active.'),
      schedule_config: zOpenApi.record(zOpenApi.unknown()).nullable().optional().describe('Custom scheduling configuration.'),
      created_at: zOpenApi.string().datetime().optional().describe('Creation timestamp.'),
      updated_at: zOpenApi.string().datetime().optional().describe('Last update timestamp.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID scoped from the request context.'),
    }),
  );

  const MaintenanceSchedulePayload = registry.registerSchema(
    'AssetMaintenanceSchedulePayload',
    zOpenApi.object({
      data: MaintenanceScheduleResource.optional().describe('Updated schedule row. Undefined when the schedule ID does not exist or belongs to another tenant.'),
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
    zOpenApi.object({
      schedule_type: zOpenApi.enum(['preventive', 'inspection', 'calibration', 'replacement']).describe('Required type of maintenance schedule.'),
      frequency: zOpenApi.enum(['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'custom']).describe('Required recurrence frequency used to calculate next_maintenance.'),
      frequency_interval: zOpenApi.number().min(1).optional().describe('Frequency multiplier. Defaults to service logic when absent.'),
      start_date: zOpenApi.string().datetime().optional().describe('Schedule start date/time. The current schema makes this optional; the service falls back to now when absent.'),
      end_date: zOpenApi.string().datetime().optional().describe('Optional schedule end date/time.'),
      notes: zOpenApi.string().optional().describe('Free-text schedule notes.'),
      assigned_to: zOpenApi.string().uuid().optional().describe('Assigned user UUID from users.user_id.'),
      is_active: zOpenApi.boolean().optional().describe('Whether the schedule is active. Defaults to true in validation.'),
      schedule_config: zOpenApi.record(zOpenApi.unknown()).optional().describe('Custom scheduling configuration.'),
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
      history_id: zOpenApi.string().uuid().describe('Primary key from asset_maintenance_history.history_id.'),
      asset_id: zOpenApi.string().uuid().describe('Asset UUID from asset_maintenance_history.asset_id.'),
      schedule_id: zOpenApi.string().uuid().nullable().optional().describe('Optional related maintenance schedule UUID.'),
      maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']).or(zOpenApi.string()).describe('Maintenance type recorded for the history row.'),
      performed_by: zOpenApi.string().uuid().describe('User UUID supplied in the maintenance record.'),
      performed_at: zOpenApi.string().datetime().describe('Timestamp when maintenance was performed.'),
      duration_hours: zOpenApi.number().nullable().optional().describe('Maintenance duration in hours, when recorded.'),
      cost: zOpenApi.number().nullable().optional().describe('Maintenance cost, when recorded.'),
      notes: zOpenApi.string().nullable().optional().describe('Free-text notes.'),
      parts_used: zOpenApi.array(zOpenApi.string()).nullable().optional().describe('Parts used, when recorded.'),
      maintenance_data: zOpenApi.record(zOpenApi.unknown()).nullable().optional().describe('Arbitrary structured maintenance data.'),
      description: zOpenApi.string().nullable().optional().describe('Description column when present in the maintenance history table.'),
      created_at: zOpenApi.string().datetime().describe('History creation timestamp.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID scoped from the request context.'),
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
      schedule_id: zOpenApi.string().uuid().optional().describe('Optional maintenance schedule UUID. If present and found for the tenant, the schedule last_maintenance and next_maintenance are updated.'),
      maintenance_type: zOpenApi.enum(['preventive', 'corrective', 'inspection', 'calibration', 'replacement']).describe('Required type of maintenance performed.'),
      performed_by: zOpenApi.string().uuid().describe('Required UUID of the user who performed maintenance. The service does not validate this user before insert.'),
      performed_at: zOpenApi.string().datetime().describe('Required timestamp when maintenance was performed.'),
      duration_hours: zOpenApi.number().min(0).optional().describe('Optional duration in hours.'),
      cost: zOpenApi.number().min(0).optional().describe('Optional cost.'),
      notes: zOpenApi.string().optional().describe('Optional notes.'),
      parts_used: zOpenApi.array(zOpenApi.string()).optional().describe('Optional list of parts used.'),
      maintenance_data: zOpenApi.record(zOpenApi.unknown()).optional().describe('Optional structured maintenance data.'),
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
      related_asset_id: zOpenApi.string().uuid().describe('Related asset UUID from assets.asset_id.'),
      relationship_type: zOpenApi.string().min(1).describe('Free-form relationship type. Must be non-empty.'),
    }),
  );

  const AssetRelationshipRow = registry.registerSchema(
    'AssetRelationshipRow',
    zOpenApi.object({
      relationship_id: zOpenApi.string().uuid().describe('Primary key from asset_relationships.relationship_id.'),
      asset_id: zOpenApi.string().uuid().describe('Source asset UUID from asset_relationships.asset_id.'),
      related_asset_id: zOpenApi.string().uuid().describe('Related asset UUID from asset_relationships.related_asset_id.'),
      relationship_type: zOpenApi.string().describe('Free-form relationship type.'),
      tenant: zOpenApi.string().uuid().describe('Tenant UUID from asset_relationships.tenant.'),
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
      client_ids: zOpenApi.array(zOpenApi.string().uuid()).optional().describe('Optional client UUID filters.'),
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
        assets_by_type: zOpenApi.record(zOpenApi.number().int()).describe('Counts grouped by assets.asset_type.'),
        assets_by_status: zOpenApi.record(zOpenApi.number().int()).describe('Counts grouped by assets.status.'),
        assets_by_client: zOpenApi.record(zOpenApi.number().int()).describe('Top client counts grouped by clients.client_name. The service limits this grouping to 10 clients.'),
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
      'Lists assets for the authenticated tenant with pagination, sorting, and asset filters. The controller validates query parameters with assetListQuerySchema, calls requireRequestContext, queries assets filtered by assets.tenant, joins clients for client_name, computes warranty_status, and adds HATEOAS links from asset_id. In the current route wiring, the edge middleware only checks x-api-key presence and the route is not wrapped with withApiKeyAuth or ApiBaseController authentication, so req.context may be absent and produce a 500 INTERNAL_ERROR before the intended tenant-scoped list can run.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Creates an asset for the authenticated tenant. The request body is validated with createAssetWithExtensionSchema; client_id, asset_type, asset_tag, name, and status are required. AssetService.create writes assets.tenant from the request context, inserts the asset, optionally upserts asset-type-specific extension_data, publishes an ASSET_CREATED event, and returns getWithDetails with HATEOAS links. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before creation.',
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
        description: 'Request body validation failed.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Updates the status field for up to 50 assets in the authenticated tenant. The controller validates asset_ids and status with bulkAssetStatusSchema, then calls AssetService.update for each asset_id with { status }. Each update is tenant-scoped by assets.asset_id and assets.tenant and publishes an ASSET_UPDATED event. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before updates.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Updates up to 50 assets in the authenticated tenant. Each array item supplies an asset_id and partial update data validated with updateAssetSchema. The controller calls AssetService.update for every item, tenant-scoping each update by asset_id and context.tenant and publishing ASSET_UPDATED events. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before updates.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Removes a document association row by document_associations.association_id for the authenticated tenant. The service deletes rows where association_id and tenant match and does not verify entity_type in this method. The controller intends to return an empty success response after deletion, but currently calls createApiResponse(null, 204) inside NextResponse.json, which can throw because JSON responses cannot use status 204 with a body. In the current route wiring, req.context may also be absent because no route-level API-key auth wrapper sets it, causing a 500 before deletion.',
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
        description: 'Unexpected error, including missing req.context or the current 204 JSON response construction issue.',
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
      'Exports assets for the authenticated tenant. The controller validates assetExportQuerySchema, but currently ignores the validated filters and include flags and calls AssetService.list with default options. When format=csv or omitted, it returns text/csv with Content-Disposition attachment filename=assets.csv. When format=json or format=xlsx, it returns a JSON success envelope; xlsx generation is not implemented. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before export.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      query: AssetExportQuery,
    },
    responses: {
      200: {
        description: 'Asset export returned successfully. For format=csv or omitted, the handler returns text/csv with an attachment filename; for format=json or format=xlsx, the handler currently returns this JSON envelope.',
        schema: AssetExportJsonResponse,
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
        description: 'Authenticated request context lacks permission to read/export assets when auth wiring is present.',
        schema: ApiErrorEnvelope,
      },
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'read',
      'x-csv-content-disposition': 'attachment; filename=assets.csv',
      'x-export-filters-currently-ignored': true,
      'x-xlsx-generation-implemented': false,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/maintenance/{scheduleId}',
    summary: 'Delete asset maintenance schedule',
    description:
      'Deletes a maintenance schedule by asset_maintenance_schedules.schedule_id for the authenticated tenant. The service scopes deletion by schedule_id and context.tenant and performs no existence check, so missing or cross-tenant IDs are silent no-ops. The controller intends to return 204 with no body, but currently constructs a JSON response with status 204, which can throw in NextResponse. In the current route wiring, req.context may also be absent because no route-level API-key auth wrapper sets it, causing a 500 before deletion.',
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
        description: 'Unexpected error, including missing req.context or the current 204 JSON response construction issue.',
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
      'Updates a maintenance schedule by asset_maintenance_schedules.schedule_id for the authenticated tenant. All request fields are optional because updateMaintenanceScheduleSchema is a partial form of the create schema. If frequency, frequency_interval, or start_date are supplied, the service loads the existing schedule for the tenant and recalculates next_maintenance. Missing or cross-tenant schedule IDs result in a 200 response with an undefined nested data value rather than 404. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before update.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: {
      params: MaintenanceScheduleParams,
      body: {
        schema: MaintenanceScheduleUpdateRequest,
        description: 'Partial maintenance schedule update data.',
        required: true,
      },
    },
    responses: {
      200: {
        description: 'Maintenance schedule updated successfully. If the ID is not found, the nested data field may be absent.',
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
      500: {
        description: 'Unexpected error, including missing req.context in the current route wiring.',
        schema: ApiErrorEnvelope,
      },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-recalculates-next-maintenance': true,
      'x-no-not-found-on-missing-id': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'delete',
    path: '/api/v1/assets/relationships/{relationshipId}',
    summary: 'Delete asset relationship',
    description:
      'Deletes an asset relationship by asset_relationships.relationship_id for the authenticated tenant. The service hard-deletes rows where relationship_id and context.tenant match, publishes no event, and performs no existence check; missing or cross-tenant IDs are silent no-ops. The controller intends to return 204 with no body, but currently constructs a JSON response with status 204, which can throw in NextResponse. In the current route wiring, req.context may also be absent because no route-level API-key auth wrapper sets it, causing a 500 before deletion.',
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
        description: 'Unexpected error, including missing req.context or the current 204 JSON response construction issue.',
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
      'Searches tenant assets with a required query term and optional field, asset type, status, client, extension-data, and limit parameters. The service searches assets scoped to context.tenant, joins clients for client_name, and optionally loads asset-type-specific extension data per result. The response is not paginated and includes HATEOAS links for each asset; the top-level search link currently points at /api/v2/assets/search. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before search.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Returns tenant-scoped aggregate asset statistics including total counts, counts by type/status/client, warranty counts, and maintenance due/overdue counts. The service runs multiple aggregate queries filtered by context.tenant; assets_by_client is limited to the top 10 client names. The response links currently point at /api/v2/assets paths. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before statistics can be calculated.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Returns detailed asset information for the authenticated tenant, including joined client_name, computed warranty_status, client details, type-specific extension_data, relationships, document associations, maintenance schedules, and HATEOAS links. The service first loads assets by asset_id and context.tenant, then loads related data in parallel. If the asset is not found, the controller returns a 404 error envelope. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before lookup.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Partially updates base asset fields for the authenticated tenant. The request body is validated with updateAssetSchema, where all fields are optional. AssetService.update scopes the update by asset_id and context.tenant, writes updated_at, publishes ASSET_UPDATED, and returns the refreshed base asset with joined client_name and warranty_status. This REST path does not update extension data, create asset history records, or wrap the update in a transaction. Missing assets currently lead to a 500 when the controller tries to add links to a null result rather than a clean 404. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before update.',
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
        description: 'Request body validation failed, or the database rejected an invalid reference.',
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
        description: 'Unexpected error, including missing req.context or null asset result handling in the current route wiring.',
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
      'Hard-deletes an asset for the authenticated tenant. AssetService.delete first loads the asset by asset_id and context.tenant, deletes asset-type-specific extension data, deletes tenant_external_entity_mappings for the asset, deletes the assets row, and publishes ASSET_DELETED. The method overrides the BaseService softDelete configuration and does not explicitly clean every related table handled by the server-action delete path. Missing assets throw a generic Error and currently surface as 500 via handleApiError rather than 404. The controller also constructs a JSON response with status 204, which can throw in NextResponse. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before deletion.',
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
        description: 'Unexpected error, including missing req.context, generic Asset not found errors, or the current 204 JSON response construction issue.',
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
      'Returns document_associations rows for an asset in the authenticated tenant where entity_type is asset and entity_id is the path asset ID. The service joins documents to add original_filename, file_size, mime_type, and uploaded_at. It does not check whether the asset exists first, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before lookup.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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
      'Creates a document_associations row that links the path asset ID to the supplied document_id. The body is validated with createAssetDocumentSchema; document_id is required and notes is optional. The service inserts entity_type=asset, entity_id from the path, document_id, notes, tenant from context, and created_at, then returns the inserted row. It does not verify that the asset or document belongs to the same tenant before insert, does not set created_by, and publishes no event. Foreign-key or unique constraint errors surface through handleApiError. In the current route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before insert.',
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
        description: 'Unexpected error, including missing req.context in the current route wiring.',
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


  registry.registerRoute({
    method: 'get',
    path: '/api/v1/assets/{id}/history',
    summary: 'List asset maintenance history',
    description:
      'Returns all maintenance history rows for the path asset ID in the authenticated tenant, ordered by performed_at descending. The service joins users to add performed_by_user_name and filters asset_maintenance_history by asset_id and context.tenant. It performs no asset existence check, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before lookup.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Maintenance history rows returned successfully.', schema: MaintenanceHistoryResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset history when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error, including missing req.context in the current route wiring.', schema: ApiErrorEnvelope },
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
      'Returns maintenance schedule rows for the path asset ID in the authenticated tenant. The service filters asset_maintenance_schedules by asset_id and context.tenant and joins users to add assigned_user_name. It performs no asset existence check, so nonexistent or cross-tenant asset IDs return 200 with an empty array. Response links currently point at /api/v2/assets paths. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before lookup.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Maintenance schedules returned successfully.', schema: MaintenanceScheduleListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset maintenance schedules when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error, including missing req.context in the current route wiring.', schema: ApiErrorEnvelope },
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
      'Creates a maintenance schedule for the path asset ID in the authenticated tenant. The request body is validated with createMaintenanceScheduleSchema; schedule_type and frequency are required, while start_date is optional in the current shared date schema and the service falls back to now when absent. The service inserts asset_id from the path, tenant from context, timestamps, and a calculated next_maintenance value. It does not verify asset existence, does not set created_by, and publishes no event. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before insert.',
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
      409: { description: 'Database unique constraint conflict if one is enforced.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error, including missing req.context in the current route wiring.', schema: ApiErrorEnvelope },
    },
    extensions: {
      ...assetRouteExtensions,
      'x-rbac-resource': 'asset',
      'x-rbac-action': 'update',
      'x-no-asset-existence-check': true,
      'x-calculates-next-maintenance': true,
      'x-created-by-set': false,
      'x-no-event-published': true,
    },
    edition: 'both',
  });

  registry.registerRoute({
    method: 'post',
    path: '/api/v1/assets/{id}/maintenance/record',
    summary: 'Record asset maintenance',
    description:
      'Inserts an asset_maintenance_history row for the path asset ID in the authenticated tenant. The request body requires maintenance_type, performed_by, and performed_at; schedule_id, duration, cost, notes, parts, and structured maintenance_data are optional. If schedule_id is supplied and a matching tenant schedule exists, the service updates that schedule last_maintenance and next_maintenance. It does not verify asset existence or performed_by before insert, does not set created_by, and publishes no event. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before insert.',
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
      500: { description: 'Unexpected error, including missing req.context in the current route wiring.', schema: ApiErrorEnvelope },
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
      'Returns asset_relationships rows for the path asset ID in the authenticated tenant, joined with the related assets table for display fields. The service filters by asset_relationships.asset_id and context.tenant and joins related assets on matching tenant. It performs no parent asset existence check and does not filter soft-deleted related assets. Response links currently point at /api/v2/assets paths. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before lookup.',
    tags: [tag],
    security: [{ ApiKeyAuth: [] }],
    request: { params: AssetIdParams },
    responses: {
      200: { description: 'Asset relationships returned successfully.', schema: AssetRelationshipListResponse },
      401: { description: 'x-api-key is missing at middleware.', schema: MiddlewareUnauthorizedResponse },
      403: { description: 'Authenticated request context lacks permission to read asset relationships when auth wiring is present.', schema: ApiErrorEnvelope },
      500: { description: 'Unexpected error, including missing req.context in the current route wiring.', schema: ApiErrorEnvelope },
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
      'Creates a relationship row between the path asset ID and related_asset_id for the authenticated tenant. The request body requires related_asset_id and non-empty relationship_type. The service rejects self relationships and duplicate source/related pairs, but currently throws generic Errors for those cases, which surface as 500 rather than 400 or 409. The inserted row is returned without joined related asset details. In the current v1 asset route wiring, req.context may be absent because no route-level API-key auth wrapper sets it, causing a 500 before insert.',
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
      500: { description: 'Unexpected error, including missing req.context, self-relationship errors, or duplicate relationship errors in the current implementation.', schema: ApiErrorEnvelope },
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

}
