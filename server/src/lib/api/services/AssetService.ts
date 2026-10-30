/**
 * Asset API Service
 * Handles all asset-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult, tenantDb } from '@alga-psa/db';
import { 
  CreateAssetData,
  CreateAssetWithExtensionData,
  UpdateAssetData,
  AssetFilterData,
  CreateAssetRelationshipData,
  CreateAssetDocumentData,
  CreateMaintenanceScheduleData,
  UpdateMaintenanceScheduleData,
  RecordMaintenanceData,
  AssetSearchData,
  AssetExportQuery,
  WorkstationAssetData,
  NetworkDeviceAssetData,
  ServerAssetData,
  MobileDeviceAssetData,
  PrinterAssetData,
  parseAssetExtensionData
} from '../schemas/asset';
import { publishEvent, publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { buildAssetCreatedPayload, buildAssetUpdatedPayload } from '@alga-psa/workflow-streams';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/apiMiddleware';
import { resolveWritableAssetType, resolveAttributeSchemaForWrite, validateAttributesForWrite, attributesMergeExpression, serializeAttributesForInsert } from '@alga-psa/assets/lib/assetAttributeWrites';
import { advanceMaintenanceDate, parseCustomRecurrence } from '@alga-psa/assets/lib/maintenanceRecurrence';
import { isTypedAssetWriteError } from '@alga-psa/assets/lib/assetTypeAttributes';
import { validateAssetStatusSlug } from '@alga-psa/assets/lib/assetStatusRegistry';
import { isAssetAssigneeError, setAssetAssignee } from '@alga-psa/assets/lib/assetAssignment';
import { getAssetGroupSummary, removeAssetFromAnyGroup } from '@alga-psa/assets/lib/assetGroups';
import { assertBillingProfileForClient } from '@alga-psa/shared/models/assetBillingProfileModel';

function validationDetails(issues: Array<{ key: string; code: string; message: string }>) {
  return issues.map((issue) => ({ path: ['attributes', issue.key], code: issue.code, message: issue.message }));
}

function hasExtensionData(data: Record<string, unknown> | undefined): data is Record<string, unknown> {
  return !!data && Object.keys(data).length > 0;
}

function validateExtensionData(assetType: string, data: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseAssetExtensionData(assetType, data);
  if (!parsed) {
    throw new ValidationError('Invalid extension_data', [
      { path: ['extension_data'], code: 'unsupported_asset_type', message: `Asset type '${assetType}' has no extension data` }
    ]);
  }
  if (!parsed.success) {
    throw new ValidationError('Invalid extension_data', parsed.error.issues.map((issue) => ({
      path: ['extension_data', ...issue.path],
      code: issue.code,
      message: issue.message
    })));
  }
  return parsed.data;
}

function mapInvalidAssetTypeError(error: unknown, slug: string): unknown {
  if (isTypedAssetWriteError(error)) {
    try {
      const parsed = JSON.parse((error as Error).message);
      if (parsed.kind === 'invalid_asset_type') {
        const message = `Unknown asset_type '${slug}'`;
        return new ValidationError(message, [{ path: ['asset_type'], code: 'invalid_asset_type', message }]);
      }
    } catch {
      // Keep unrelated errors intact if their message is not typed JSON.
    }
  }
  return error;
}

async function resolveRestAssetType(knex: Knex, tenant: string, slug: string) {
  try {
    return await resolveWritableAssetType(knex, tenant, slug);
  } catch (error) {
    throw mapInvalidAssetTypeError(error, slug);
  }
}

async function resolveRestAttributeSchema(
  knex: Knex,
  tenant: string,
  input: { nextAssetType?: string; storedAssetType?: string; attributesProvided: boolean }
) {
  try {
    return await resolveAttributeSchemaForWrite(knex, tenant, input);
  } catch (error) {
    throw mapInvalidAssetTypeError(error, input.nextAssetType ?? input.storedAssetType ?? '');
  }
}

function scopedTable<Row extends object = Record<string, any>>(
  conn: Knex | Knex.Transaction,
  tenant: string,
  tableExpression: string
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table<Row>(tableExpression) as Knex.QueryBuilder<any, any>;
}

export class AssetService extends BaseService<any> {
  constructor() {
    super({
      tableName: 'assets',
      primaryKey: 'asset_id',
      tenantColumn: 'tenant',
      softDelete: true,
      auditFields: {
        createdBy: 'created_by',
        updatedBy: 'updated_by',
        createdAt: 'created_at',
        updatedAt: 'updated_at'
      },
      searchableFields: ['asset_tag', 'name', 'serial_number', 'location', 'manufacturer', 'model'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
  }

  /**
   * Range keys the asset list accepts: the common created_ and updated_ keys
   * plus the purchase-date and warranty windows. Any other `_from`/`_to` key is
   * rejected by `applyRangeFilters`.
   */
  protected rangeFilterColumns(): Record<string, string> {
    return {
      ...super.rangeFilterColumns(),
      created_from: `${this.tableName}.created_at`,
      created_to: `${this.tableName}.created_at`,
      updated_from: `${this.tableName}.updated_at`,
      updated_to: `${this.tableName}.updated_at`,
      purchase_date_from: `${this.tableName}.purchase_date`,
      purchase_date_to: `${this.tableName}.purchase_date`,
      warranty_end_from: `${this.tableName}.warranty_end_date`,
      warranty_end_to: `${this.tableName}.warranty_end_date`,
    };
  }

  async list(options: ListOptions, context: ServiceContext, filters?: AssetFilterData): Promise<ListResult<any>> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, this.tableName);

    // Common and asset-specific range filters. Unsupported range keys fail loudly.
    if (filters) {
      this.applyRangeFilters(query, filters);
    }

    // Apply filters
    if (filters) {
      if (filters.asset_tag) {
        query.where(`${this.tableName}.asset_tag`, 'ilike', `%${filters.asset_tag}%`);
      }
      if (filters.name) {
        query.where(`${this.tableName}.name`, 'ilike', `%${filters.name}%`);
      }
      if (filters.client_id) {
        query.where(`${this.tableName}.client_id`, filters.client_id);
      }
      if (filters.location_id) {
        query.where(`${this.tableName}.location_id`, filters.location_id);
      }
      if (filters.contact_name_id) {
        query.where(`${this.tableName}.contact_name_id`, filters.contact_name_id);
      }
      if (filters.manufacturer) {
        query.where(`${this.tableName}.manufacturer`, 'ilike', `%${filters.manufacturer}%`);
      }
      if (filters.model) {
        query.where(`${this.tableName}.model`, 'ilike', `%${filters.model}%`);
      }
      if (filters.vendor_id) {
        query.where(`${this.tableName}.vendor_id`, filters.vendor_id);
      }
      if (filters.billing_profile_id) {
        query.where(`${this.tableName}.billing_profile_id`, filters.billing_profile_id);
      }
      if (filters.asset_type) {
        query.where(`${this.tableName}.asset_type`, filters.asset_type);
      }
      if (filters.status) {
        query.where(`${this.tableName}.status`, filters.status);
      }
      if (filters.location) {
        query.where(`${this.tableName}.location`, 'ilike', `%${filters.location}%`);
      }
      if (filters.client_name) {
        tenantDb(knex, context.tenant).tenantJoin(query, 'clients', 'assets.client_id', 'clients.client_id');
        query.where('clients.client_name', 'ilike', `%${filters.client_name}%`);
      }
      if (filters.has_warranty !== undefined) {
        if (filters.has_warranty) {
          query.whereNotNull(`${this.tableName}.warranty_end_date`);
        } else {
          query.whereNull(`${this.tableName}.warranty_end_date`);
        }
      }
      if (filters.warranty_expired !== undefined) {
        if (filters.warranty_expired) {
          query.where(`${this.tableName}.warranty_end_date`, '<', new Date());
        } else {
          const tableName = this.tableName;
          query.where(function() {
            this.where(`${tableName}.warranty_end_date`, '>=', new Date())
              .orWhereNull(`${tableName}.warranty_end_date`);
          });
        }
      }
    }

    // Add joins for additional data
    tenantDb(knex, context.tenant).tenantJoin(query, 'clients', 'assets.client_id', 'clients.client_id', {
      type: 'left',
    });
    tenantDb(knex, context.tenant).tenantJoin(query, 'vendors', 'assets.vendor_id', 'vendors.vendor_id', {
      type: 'left',
    });
    query
      .select(
        `${this.tableName}.*`,
        'clients.client_name',
        'vendors.vendor_name',
        knex.raw(`
          CASE 
            WHEN ${this.tableName}.warranty_end_date IS NULL THEN 'no_warranty'
            WHEN ${this.tableName}.warranty_end_date < NOW() THEN 'expired'
            WHEN ${this.tableName}.warranty_end_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
            ELSE 'active'
          END as warranty_status
        `)
      );

    // Execute queries with pagination
    const countQuery = scopedTable(knex, context.tenant, this.tableName);

    if (filters) {
      // Apply the same range filters to count query
      this.applyRangeFilters(countQuery, filters);
      // Apply the same filters to count query
      if (filters.client_id) {
        countQuery.where(`${this.tableName}.client_id`, filters.client_id);
      }
      if (filters.location_id) {
        countQuery.where(`${this.tableName}.location_id`, filters.location_id);
      }
      if (filters.contact_name_id) {
        countQuery.where(`${this.tableName}.contact_name_id`, filters.contact_name_id);
      }
      if (filters.status) {
        countQuery.where(`${this.tableName}.status`, filters.status);
      }
      if (filters.asset_type) {
        countQuery.where(`${this.tableName}.asset_type`, filters.asset_type);
      }
      if (filters.warranty_expired !== undefined) {
        if (filters.warranty_expired) {
          countQuery.where(`${this.tableName}.warranty_end_date`, '<', new Date());
        } else {
          const tableName = this.tableName;
          countQuery.where(function() {
            this.where(`${tableName}.warranty_end_date`, '>=', new Date())
              .orWhereNull(`${tableName}.warranty_end_date`);
          });
        }
      }
    }

    // Apply pagination
    const page = options.page || 1;
    const limit = options.limit || 25;
    const offset = (page - 1) * limit;
    
    query.limit(limit).offset(offset);

    // Apply sorting
    const sortField = options.sort || 'created_at';
    const sortOrder = options.order || 'desc';
    query.orderBy(sortField, sortOrder);

    const [data, [{ count }]] = await Promise.all([
      query,
      countQuery.count('* as count')
    ]);

    return {
      data,
      total: parseInt(count as string)
    };
  }

  async getById(id: string, context: ServiceContext): Promise<any | null> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, this.tableName)
      .where({
        [`${this.tableName}.${this.primaryKey}`]: id
      });
    tenantDb(knex, context.tenant).tenantJoin(query, 'clients', 'assets.client_id', 'clients.client_id', {
      type: 'left',
    });
    tenantDb(knex, context.tenant).tenantJoin(query, 'vendors', 'assets.vendor_id', 'vendors.vendor_id', {
      type: 'left',
    });
    // FR-C6/FR-E3: mobile and the REST clients read the assignee and the group
    // off this payload, so they travel with the asset rather than needing a
    // second round trip.
    tenantDb(knex, context.tenant).tenantJoin(query, 'contacts', 'assets.contact_name_id', 'contacts.contact_name_id', {
      type: 'left',
    });

    const asset = await query.select(
        `${this.tableName}.*`,
        'clients.client_name',
        'vendors.vendor_name',
        'contacts.full_name as contact_name',
        knex.raw(`
          CASE
            WHEN ${this.tableName}.warranty_end_date IS NULL THEN 'no_warranty'
            WHEN ${this.tableName}.warranty_end_date < NOW() THEN 'expired'
            WHEN ${this.tableName}.warranty_end_date < NOW() + INTERVAL '30 days' THEN 'expiring_soon'
            ELSE 'active'
          END as warranty_status
        `)
      )
      .first();

    if (!asset) return null;

    asset.group = await getAssetGroupSummary(knex, context.tenant, id);
    return asset;
  }

  /**
   * The record context the authorization kernel evaluates for an asset read.
   * Mirrors `resolveAssetAuthorizationRecords` in the assets package (assignees
   * and teams come from asset_associations). Tenant-scoped: another tenant's id
   * resolves to null.
   */
  async getAuthorizationRecord(id: string, context: ServiceContext): Promise<Record<string, any> | null> {
    const knex = await this.getDbForContext(context);
    const asset = await scopedTable(knex, context.tenant, this.tableName)
      .where({ asset_id: id })
      .select('asset_id', 'client_id')
      .first();
    if (!asset) return null;

    const associations: Array<{ entity_type: string; entity_id: string }> = await scopedTable(
      knex,
      context.tenant,
      'asset_associations',
    )
      .where({ asset_id: id })
      .select('entity_type', 'entity_id');

    const assignedUserIds = associations.filter((a) => a.entity_type === 'user').map((a) => a.entity_id);
    const teamIds = associations.filter((a) => a.entity_type === 'team').map((a) => a.entity_id);
    return {
      id: asset.asset_id,
      ownerUserId: assignedUserIds[0] ?? null,
      assignedUserIds,
      clientId: asset.client_id ?? null,
      teamIds,
    };
  }

  async getWithDetails(id: string, context: ServiceContext): Promise<any | null> {
    const asset = await this.getById(id, context);
    if (!asset) return null;

    // The auxiliary sub-objects are best-effort: a failing join (some carry
    // legacy schema drift) must degrade to empty, never 500 the whole asset.
    const settle = async <T>(work: Promise<T>, fallback: T): Promise<T> => {
      try {
        return await work;
      } catch (error) {
        console.error(`[AssetService.getWithDetails] sub-query failed for asset ${id}:`, error);
        return fallback;
      }
    };

    const [client, extensionData, relationships, documents, maintenanceSchedules] = await Promise.all([
      settle(this.getAssetClient(asset.client_id, context), null),
      settle(this.getAssetExtensionData(id, asset.asset_type, context), null),
      settle(this.getAssetRelationships(id, context), [] as any[]),
      settle(this.getAssetDocuments(id, context), [] as any[]),
      settle(this.getMaintenanceSchedules(id, context), [] as any[]),
    ]);

    return {
      ...asset,
      client,
      extension_data: extensionData,
      relationships,
      documents,
      maintenance_schedules: maintenanceSchedules
    };
  }

  async create(data: CreateAssetWithExtensionData, context: ServiceContext): Promise<any> {
    // LEVERAGE: friction rest-asset-write-path — converge REST writes with createAssetRecord/updateAssetRecord for shared history and workflow behavior.
    const { extension_data, attributes, ...assetData } = data;
    const knex = await this.getDbForContext(context);

    const typeEntry = await resolveRestAssetType(knex, context.tenant, assetData.asset_type);
    const issues = validateAttributesForWrite(typeEntry, attributes, 'create');
    if (issues.length) throw new ValidationError('Invalid asset attributes', validationDetails(issues));
    const extensionData = hasExtensionData(extension_data)
      ? validateExtensionData(assetData.asset_type, extension_data)
      : undefined;

    if (assetData.location_id) {
      await this.assertLocationBelongsToClient(knex, context.tenant, assetData.client_id, assetData.location_id);
    }
    if (assetData.contact_name_id) {
      await this.assertContactBelongsToClient(knex, context.tenant, assetData.client_id, assetData.contact_name_id);
    }
    if (assetData.vendor_id) {
      await this.assertVendorExists(knex, context.tenant, assetData.vendor_id);
    }
    await this.assertValidStatus(knex, context.tenant, assetData.status);
    if (assetData.billing_profile_id) {
      await this.assertBillingProfile(knex, context.tenant, assetData.client_id, assetData.billing_profile_id);
    }
    if (assetData.purchase_cost !== undefined && assetData.purchase_cost !== null && !assetData.purchase_cost_currency) {
      assetData.purchase_cost_currency = await this.resolveTenantCurrency(knex, context.tenant);
    }

    // FR-C3: the assignee is applied through setAssetAssignee (source `api`)
    // so the open asset_assignments row is written with it.
    const { contact_name_id: requestedContactId, ...assetColumns } = assetData as Record<string, any>;

    const assetRecord = {
      ...assetColumns,
      contact_name_id: null,
      ...(attributes !== undefined ? { attributes: serializeAttributesForInsert(attributes) } : {}),
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    // One transaction: a rejected assignee must not leave an asset behind
    // without the contact the caller asked for, and a failed extension write
    // must not leave a committed asset with no extension row.
    const asset = await knex.transaction(async (trx) => {
      const [created] = await scopedTable(trx, context.tenant, this.tableName)
        .insert(assetRecord)
        .returning('*');

      if (requestedContactId) {
        await this.applyAssignee(trx, context, created.asset_id, requestedContactId);
      }

      if (extensionData) {
        await this.upsertExtensionData(created.asset_id, created.asset_type, extensionData, context, trx);
      }
      return created;
    });

    // Publish event
    await publishWorkflowEvent({
      eventType: 'ASSET_CREATED',
      payload: buildAssetCreatedPayload({
        assetId: asset.asset_id,
        clientId: asset.client_id || undefined,
        createdByUserId: context.userId,
        createdAt: asset.created_at,
        assetType: asset.asset_type,
        serialNumber: asset.serial_number,
      }),
      ctx: {
        tenantId: context.tenant,
        occurredAt: asset.created_at,
        actor: { actorType: 'USER', actorUserId: context.userId },
      },
    });

    return this.getWithDetails(asset.asset_id, context);
  }

  async update(id: string, data: UpdateAssetData, context: ServiceContext): Promise<any> {
    // LEVERAGE: friction rest-asset-write-path — converge REST writes with createAssetRecord/updateAssetRecord for shared history and workflow behavior.
    const knex = await this.getDbForContext(context);
    const updateData: Record<string, unknown> = { ...data };
    const attributes = data.attributes as Record<string, unknown> | undefined;
    const extensionInput = data.extension_data;
    delete updateData.attributes;
    delete updateData.extension_data;

    const needsCurrent =
      data.location_id !== undefined ||
      data.contact_name_id !== undefined ||
      data.status !== undefined ||
      data.client_id !== undefined;
    const needsAssetContext =
      needsCurrent || data.attributes !== undefined || data.asset_type !== undefined || hasExtensionData(extensionInput);

    const current = needsAssetContext
      ? await scopedTable(knex, context.tenant, this.tableName)
          .where({ [this.primaryKey]: id })
          .first('client_id', 'location_id', 'contact_name_id', 'asset_type', 'status', 'billing_profile_id')
      : null;

    if (needsAssetContext && !current) {
      throw new NotFoundError('Asset not found');
    }

    if (needsAssetContext) {
      const entry = await resolveRestAttributeSchema(knex, context.tenant, {
        nextAssetType: data.asset_type,
        storedAssetType: current!.asset_type,
        attributesProvided: attributes !== undefined,
      });
      const issues = attributes !== undefined ? validateAttributesForWrite(entry, attributes, 'merge') : [];
      if (issues.length) throw new ValidationError('Invalid asset attributes', validationDetails(issues));
      if (attributes !== undefined) updateData.attributes = attributesMergeExpression(knex, attributes);
    }

    const effectiveAssetType = data.asset_type ?? current?.asset_type;
    const extensionData = hasExtensionData(extensionInput)
      ? validateExtensionData(effectiveAssetType, extensionInput)
      : undefined;

    if (data.location_id) {
      const clientId = data.client_id || current?.client_id;
      if (!clientId) {
        throw new NotFoundError('Asset not found');
      }
      await this.assertLocationBelongsToClient(knex, context.tenant, clientId, data.location_id);
    } else if (
      data.client_id &&
      current?.client_id &&
      data.client_id !== current.client_id &&
      current.location_id &&
      data.location_id === undefined
    ) {
      // Client changed without an explicit new location — clear the stale link
      // so the asset doesn't keep pointing at the previous client's location.
      updateData.location_id = null;
    }

    if (data.contact_name_id) {
      const clientId = data.client_id || current?.client_id;
      if (!clientId) {
        throw new NotFoundError('Asset not found');
      }
      await this.assertContactBelongsToClient(knex, context.tenant, clientId, data.contact_name_id);
    } else if (
      data.client_id &&
      current?.client_id &&
      data.client_id !== current.client_id &&
      current.contact_name_id &&
      data.contact_name_id === undefined
    ) {
      // Client changed without an explicit new assignee — the old contact
      // belongs to the previous client, so clear it.
      updateData.contact_name_id = null;
    }

    if (data.vendor_id) {
      await this.assertVendorExists(knex, context.tenant, data.vendor_id);
    }
    if (data.status !== undefined) {
      await this.assertValidStatus(knex, context.tenant, data.status, current?.status);
    }
    if (data.billing_profile_id) {
      const clientId = data.client_id || current?.client_id;
      if (!clientId) throw new NotFoundError('Asset not found');
      await this.assertBillingProfile(knex, context.tenant, clientId, data.billing_profile_id);
    } else if (
      data.client_id &&
      current?.client_id &&
      data.client_id !== current.client_id &&
      data.billing_profile_id === undefined
    ) {
      // FR-F1: a profile belongs to one client, so the move clears it.
      updateData.billing_profile_id = null;
    }
    if (data.purchase_cost !== undefined) {
      if (data.purchase_cost === null) {
        updateData.purchase_cost_currency = null;
      } else if (!data.purchase_cost_currency) {
        updateData.purchase_cost_currency = await this.resolveTenantCurrency(knex, context.tenant);
      }
    }

    // FR-C3: the assignee leaves the column patch and goes through the helper.
    const assigneeProvided = Object.prototype.hasOwnProperty.call(updateData, 'contact_name_id');
    const nextContactId = assigneeProvided ? (updateData.contact_name_id as string | null) : undefined;
    delete updateData.contact_name_id;

    updateData.updated_at = new Date();

    const before = await scopedTable(knex, context.tenant, this.tableName)
      .where({ [this.primaryKey]: id })
      .first();

    // One transaction for the columns, the group removal, the assignee and the
    // extension row: separately, a failed assignment left the client move
    // committed without its FR-E5 group removal (or the other way round), and a
    // failed extension write left the rest of the same PUT committed.
    const after = await knex.transaction(async (trx) => {
      const [updated] = await scopedTable(trx, context.tenant, this.tableName)
        .where({ [this.primaryKey]: id })
        .update(updateData)
        .returning('*');

      if (!updated) {
        throw new NotFoundError('Asset not found');
      }

      if (
        data.client_id &&
        current?.client_id &&
        data.client_id !== current.client_id
      ) {
        // FR-E5: the group belongs to the old client.
        await removeAssetFromAnyGroup(trx, context.tenant, id, { actorUserId: context.userId });
      }

      if (nextContactId !== undefined) {
        await this.applyAssignee(trx, context, id, nextContactId);
      }

      if (extensionData) {
        // A retype moves the extension row to the new type's table; the old
        // one goes with the type it belonged to.
        if (data.asset_type && current?.asset_type && data.asset_type !== current.asset_type) {
          await this.deleteExtensionData(id, current.asset_type, context, trx);
        }
        await this.upsertExtensionData(id, effectiveAssetType, extensionData, context, trx);
      }

      return updated;
    });

    // Publish event
    const updatePayload = buildAssetUpdatedPayload({
      assetId: id,
      before: (before ?? {}) as Record<string, unknown>,
      after: after as Record<string, unknown>,
      updatedPaths: Object.keys(updateData).filter((key) => key !== 'updated_at'),
      updatedByUserId: context.userId,
      updatedAt: updateData.updated_at as Date,
    });
    if (updatePayload.updatedFields || updatePayload.changes) {
      await publishWorkflowEvent({
        eventType: 'ASSET_UPDATED',
        payload: updatePayload,
        ctx: {
          tenantId: context.tenant,
          occurredAt: updateData.updated_at as Date,
          actor: { actorType: 'USER', actorUserId: context.userId },
        },
      });
    }

    const asset = await this.getById(id, context);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    return asset;
  }

  private async assertLocationBelongsToClient(
    knex: Knex,
    tenant: string,
    clientId: string,
    locationId: string
  ): Promise<void> {
    const location = await scopedTable(knex, tenant, 'client_locations')
      .where({
        client_id: clientId,
        location_id: locationId,
        is_active: true,
      })
      .first('location_id');

    if (!location) {
      throw new ValidationError('Selected location is not available for this client');
    }
  }

  private async assertContactBelongsToClient(
    knex: Knex,
    tenant: string,
    clientId: string,
    contactNameId: string
  ): Promise<void> {
    const contact = await scopedTable(knex, tenant, 'contacts')
      .where({
        client_id: clientId,
        contact_name_id: contactNameId,
      })
      .whereNot({ contact_kind: 'shared_mailbox' })
      .first('contact_name_id');

    if (!contact) {
      throw new ValidationError('Selected contact is not available for this client');
    }
  }

  /**
   * FR-C3 / T099: REST writes record their assignment with source `api`, and a
   * shared-workspace member is rejected as a 400 rather than a 500.
   */
  private async applyAssignee(
    trx: Knex.Transaction,
    context: ServiceContext,
    assetId: string,
    contactId: string | null
  ): Promise<void> {
    try {
      await setAssetAssignee(trx, context.tenant, assetId, contactId, {
        actorUserId: context.userId,
        source: 'api',
      });
    } catch (error) {
      if (isAssetAssigneeError(error)) {
        throw new ValidationError(error.message, { contact_name_id: [error.message] });
      }
      throw error;
    }
  }

  /**
   * FR-B3: `status` must be an active tenant asset_statuses slug. An archived
   * status is accepted only when it is the value already stored.
   */
  private async assertValidStatus(
    knex: Knex,
    tenant: string,
    status: string | undefined,
    storedStatus?: string | null
  ): Promise<void> {
    if (status === undefined) return;
    const result = await validateAssetStatusSlug(knex, tenant, status, storedStatus);
    if (!result.ok) {
      const { error } = result as Extract<typeof result, { ok: false }>;
      throw new ValidationError(error.message, { status: [error.message] });
    }
  }

  /** FR-F1: the profile must belong to the row's client and be active. */
  private async assertBillingProfile(
    knex: Knex,
    tenant: string,
    clientId: string,
    billingProfileId: string
  ): Promise<void> {
    try {
      await assertBillingProfileForClient(knex, tenant, clientId, billingProfileId);
    } catch (error) {
      throw new ValidationError(
        error instanceof Error ? error.message : 'Selected billing profile is not available for this client',
        { billing_profile_id: ['Selected billing profile is not available for this client'] }
      );
    }
  }

  /** Suppliers come from the inventory `vendors` table (FR-A1). */
  private async assertVendorExists(knex: Knex, tenant: string, vendorId: string): Promise<void> {
    const vendor = await scopedTable(knex, tenant, 'vendors')
      .where({ vendor_id: vendorId })
      .first('vendor_id');

    if (!vendor) {
      throw new ValidationError('Selected vendor is not available');
    }
  }

  private async resolveTenantCurrency(knex: Knex, tenant: string): Promise<string> {
    const settings = await scopedTable(knex, tenant, 'default_billing_settings')
      .first('default_currency_code');
    return (settings?.default_currency_code as string | undefined) || 'USD';
  }

  private async assertAssetExists(
    knex: Knex | Knex.Transaction,
    tenant: string,
    assetId: string,
    message = 'Asset not found'
  ): Promise<void> {
    const asset = await scopedTable(knex, tenant, this.tableName)
      .where({ [this.primaryKey]: assetId })
      .first(this.primaryKey);

    if (!asset) {
      throw new NotFoundError(message);
    }
  }

  private async assertDocumentExists(
    knex: Knex | Knex.Transaction,
    tenant: string,
    documentId: string
  ): Promise<void> {
    const document = await scopedTable(knex, tenant, 'documents')
      .where({ document_id: documentId })
      .first('document_id');

    if (!document) {
      throw new NotFoundError('Document not found');
    }
  }

  private async assertUserExists(
    knex: Knex | Knex.Transaction,
    tenant: string,
    userId: string,
    message: string
  ): Promise<void> {
    const user = await scopedTable(knex, tenant, 'users')
      .where({ user_id: userId })
      .first('user_id');

    if (!user) {
      throw new NotFoundError(message);
    }
  }

  private async assertMaintenanceScheduleForAsset(
    knex: Knex | Knex.Transaction,
    tenant: string,
    scheduleId: string,
    assetId: string
  ): Promise<void> {
    const schedule = await scopedTable(knex, tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .first('schedule_id', 'asset_id');

    if (!schedule) {
      throw new NotFoundError('Maintenance schedule not found');
    }

    if (schedule.asset_id !== assetId) {
      throw new ValidationError('Maintenance schedule does not belong to this asset');
    }
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    // Get asset type for cleanup
    const asset = await this.getById(id, context);
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    // Delete extension data
    await this.deleteExtensionData(id, asset.asset_type, context);

    const knex = await this.getDbForContext(context);

    // Delete external entity mapping (e.g., NinjaOne device mapping)
    await scopedTable(knex, context.tenant, 'tenant_external_entity_mappings')
      .where({ alga_entity_type: 'asset', alga_entity_id: id })
      .del();

    // Delete main asset record (cascade will handle relationships, documents, etc.)
    await scopedTable(knex, context.tenant, this.tableName)
      .where({ [this.primaryKey]: id })
      .del();

    // Publish event
    await publishEvent({
      eventType: 'ASSET_DELETED',
      payload: {
        tenantId: context.tenant,
        assetId: id,
        userId: context.userId,
        timestamp: new Date().toISOString()
      }
    });
  }

  // Extension data management
  async getAssetExtensionData(assetId: string, assetType: string, context: ServiceContext): Promise<any | null> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return null;

    const knex = await this.getDbForContext(context);
    return scopedTable(knex, context.tenant, tableName)
      .where({ asset_id: assetId })
      .first();
  }

  /**
   * Every array-shaped extension column is `jsonb`, but node-pg renders a bare
   * JS array as an array literal, which Postgres rejects with 22P02 for a json
   * column. Mirrors encodeExtensionJsonArrays in the internal asset actions.
   */
  private encodeExtensionJsonArrays(fields: Record<string, unknown>): Record<string, unknown> {
    const encoded: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      encoded[key] = Array.isArray(value) ? JSON.stringify(value) : value;
    }
    return encoded;
  }

  async upsertExtensionData(
    assetId: string,
    assetType: string,
    data: any,
    context: ServiceContext,
    trx?: Knex
  ): Promise<void> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return;

    // The extension tables carry no created_at/updated_at columns, and
    // tenant/asset_id are the Citus partition key + PK, so they cannot appear
    // in an UPDATE SET clause.
    const { tenant: _tenant, asset_id: _assetId, ...rest } = (data ?? {}) as Record<string, unknown>;
    const extensionFields = this.encodeExtensionJsonArrays(rest);

    const conn = trx ?? (await this.getDbForContext(context));
    const existing = await scopedTable(conn, context.tenant, tableName)
      .where({ asset_id: assetId })
      .first();

    if (existing) {
      if (Object.keys(extensionFields).length === 0) return;
      await scopedTable(conn, context.tenant, tableName)
        .where({ asset_id: assetId })
        .update(extensionFields);
    } else {
      await scopedTable(conn, context.tenant, tableName)
        .insert({ tenant: context.tenant, asset_id: assetId, ...extensionFields });
    }
  }

  async deleteExtensionData(
    assetId: string,
    assetType: string,
    context: ServiceContext,
    trx?: Knex
  ): Promise<void> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return;

    const conn = trx ?? (await this.getDbForContext(context));
    await scopedTable(conn, context.tenant, tableName)
      .where({ asset_id: assetId })
      .del();
  }

  // Asset relationships. The table is directional (parent_asset_id/
  // child_asset_id); "relationships of X" are rows where X is on either side,
  // and the related asset is the other end. Resolved without a self-alias join.
  async getAssetRelationships(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const rows = await scopedTable(knex, context.tenant, 'asset_relationships')
      .where((builder) => builder
        .where('parent_asset_id', assetId)
        .orWhere('child_asset_id', assetId))
      .select('*');
    if (rows.length === 0) return [];

    const relatedId = (row: any): string => (row.parent_asset_id === assetId ? row.child_asset_id : row.parent_asset_id);
    const relatedIds: string[] = [...new Set((rows as any[]).map(relatedId))];
    const related = await scopedTable(knex, context.tenant, 'assets')
      .whereIn('asset_id', relatedIds)
      .select('asset_id', 'asset_tag', 'name', 'asset_type', 'status');
    const byId = new Map((related as any[]).map((asset) => [asset.asset_id, asset]));

    return rows.map((row: any) => {
      const other: any = byId.get(relatedId(row));
      return {
        ...row,
        related_asset_id: relatedId(row),
        direction: row.parent_asset_id === assetId ? 'child' : 'parent',
        asset_tag: other?.asset_tag ?? null,
        related_asset_name: other?.name ?? null,
        asset_type: other?.asset_type ?? null,
        status: other?.status ?? null,
      };
    });
  }

  /**
   * List tickets linked to an asset (asset_associations -> tickets).
   * Mirrors the assets.find_associated_tickets workflow action and the asset
   * detail UI, reading the same asset_associations table.
   */
  async getAssetTickets(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const query = db.table('asset_associations as aa');
    db.tenantJoin(query, 'tickets as t', 't.ticket_id', 'aa.entity_id');
    db.tenantJoin(query, 'statuses as s', 't.status_id', 's.status_id', {
      type: 'left',
      rootTenantColumn: 't.tenant',
    });
    return query
      .where({
        'aa.asset_id': assetId,
        'aa.entity_type': 'ticket'
      })
      .select(
        't.ticket_id',
        't.ticket_number',
        't.title',
        't.status_id',
        's.name as status_name',
        't.is_closed',
        't.priority_id',
        't.assigned_to',
        't.client_id',
        't.board_id',
        't.entered_at',
        't.updated_at',
        'aa.relationship_type',
        'aa.notes as association_notes',
        'aa.created_at as linked_at'
      )
      .orderBy('t.updated_at', 'desc');
  }

  /**
   * Link a ticket to an asset by inserting an asset_associations row
   * (entity_type='ticket'). Same table the asset detail UI and getAssetTickets
   * read, so the link is immediately visible from both sides.
   */
  async linkTicket(
    assetId: string,
    data: { ticket_id: string; relationship_type?: string; notes?: string },
    context: ServiceContext
  ): Promise<any> {
    const knex = await this.getDbForContext(context);

    const asset = await scopedTable(knex, context.tenant, 'assets')
      .where({ asset_id: assetId })
      .first();
    if (!asset) {
      throw new NotFoundError('Asset not found');
    }

    const ticket = await scopedTable(knex, context.tenant, 'tickets')
      .where({ ticket_id: data.ticket_id })
      .first();
    if (!ticket) {
      throw new NotFoundError('Ticket not found');
    }

    const existing = await scopedTable(knex, context.tenant, 'asset_associations')
      .where({
        asset_id: assetId,
        entity_id: data.ticket_id,
        entity_type: 'ticket'
      })
      .first();
    if (existing) {
      throw new ConflictError('Ticket is already linked to this asset');
    }

    const [created] = await tenantDb(knex, context.tenant).table('asset_associations')
      .insert({
        tenant: context.tenant,
        asset_id: assetId,
        entity_id: data.ticket_id,
        entity_type: 'ticket',
        relationship_type: data.relationship_type || 'affected',
        notes: data.notes ?? null,
        created_by: context.userId,
        created_at: new Date().toISOString()
      })
      .returning('*');

    return created;
  }

  /**
   * Remove the asset_associations row linking a ticket to an asset.
   */
  async unlinkTicket(assetId: string, ticketId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const deleted = await scopedTable(knex, context.tenant, 'asset_associations')
      .where({
        asset_id: assetId,
        entity_id: ticketId,
        entity_type: 'ticket'
      })
      .del();

    if (!deleted) {
      throw new NotFoundError('Asset-ticket association not found');
    }
  }

  async createRelationship(assetId: string, data: CreateAssetRelationshipData, context: ServiceContext): Promise<any> {
    // Prevent circular relationships
    if (assetId === data.related_asset_id) {
      throw new ValidationError('Cannot create relationship with self');
    }

    // Check for existing relationship
    const knex = await this.getDbForContext(context);
    await this.assertAssetExists(knex, context.tenant, assetId);
    await this.assertAssetExists(knex, context.tenant, data.related_asset_id, 'Related asset not found');

    const existing = await scopedTable(knex, context.tenant, 'asset_relationships')
      .where({
        asset_id: assetId,
        related_asset_id: data.related_asset_id
      })
      .first();

    if (existing) {
      throw new ConflictError('Relationship already exists');
    }

    const relationshipData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      created_at: new Date()
    };

    const [relationship] = await tenantDb(knex, context.tenant).table('asset_relationships')
      .insert(relationshipData)
      .returning('*');

    return relationship;
  }

  async deleteRelationship(relationshipId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const deleted = await scopedTable(knex, context.tenant, 'asset_relationships')
      .where({ relationship_id: relationshipId })
      .del();

    if (!deleted) {
      throw new NotFoundError('Asset relationship not found');
    }
  }

  // Asset documents
  async getAssetDocuments(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const query = db.table('document_associations');
    db.tenantJoin(query, 'documents', 'document_associations.document_id', 'documents.document_id');
    // documents has no original_filename/uploaded_at: the upload name and time
    // live on external_files (absent for in-app documents), so fall back to the
    // document's own name and timestamps.
    db.tenantJoin(query, 'external_files', 'documents.file_id', 'external_files.file_id', { type: 'left' });
    return query
      .where({
        'document_associations.entity_type': 'asset',
        'document_associations.entity_id': assetId
      })
      .select(
        'document_associations.*',
        knex.raw('COALESCE(external_files.original_name, documents.document_name) AS original_filename'),
        'documents.file_size',
        'documents.mime_type',
        knex.raw('COALESCE(external_files.created_at, documents.entered_at, documents.updated_at) AS uploaded_at')
      );
  }

  async associateDocument(assetId: string, data: CreateAssetDocumentData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    await this.assertAssetExists(knex, context.tenant, assetId);
    await this.assertDocumentExists(knex, context.tenant, data.document_id);

    const associationData = {
      entity_type: 'asset',
      entity_id: assetId,
      document_id: data.document_id,
      notes: data.notes || null,
      tenant: context.tenant,
      created_at: new Date()
    };

    const [association] = await tenantDb(knex, context.tenant).table('document_associations')
      .insert(associationData)
      .returning('*');

    return association;
  }

  async removeDocumentAssociation(associationId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const deleted = await scopedTable(knex, context.tenant, 'document_associations')
      .where({ association_id: associationId })
      .del();

    if (!deleted) {
      throw new NotFoundError('Asset document association not found');
    }
  }

  // Maintenance management
  async getMaintenanceSchedules(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    // The schedule table has no assigned_to; it records created_by. Join on
    // that to surface who set the schedule up (nullable-safe left join).
    const query = scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({
        'asset_maintenance_schedules.asset_id': assetId
      })
      .select(
        'asset_maintenance_schedules.*',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as created_by_name`)
      );
    tenantDb(knex, context.tenant).tenantJoin(query, 'users', 'asset_maintenance_schedules.created_by', 'users.user_id', {
      type: 'left',
    });
    return query;
  }

  async createMaintenanceSchedule(assetId: string, data: CreateMaintenanceScheduleData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    this.assertCustomRecurrence(data.frequency, data.schedule_config);
    return knex.transaction(async (trx) => {
      await this.assertAssetExists(trx, context.tenant, assetId);
      const [schedule] = await scopedTable(trx, context.tenant, 'asset_maintenance_schedules')
        .insert({
          ...data,
          description: data.description ?? null,
          asset_id: assetId,
          tenant: context.tenant,
          created_by: context.userId,
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');

      await scopedTable(trx, context.tenant, 'asset_maintenance_notifications').insert({
        tenant: context.tenant,
        schedule_id: schedule.schedule_id,
        asset_id: assetId,
        notification_type: 'upcoming',
        notification_date: schedule.next_maintenance,
        notification_data: {
          schedule_name: schedule.schedule_name,
          maintenance_type: schedule.maintenance_type
        }
      });

      if (schedule.is_active) {
        await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences').insert({
          tenant: context.tenant, schedule_id: schedule.schedule_id, asset_id: assetId,
          due_date: schedule.next_maintenance, status: 'open'
        });
      }
      return schedule;
    });
  }

  async updateMaintenanceSchedule(scheduleId: string, data: UpdateMaintenanceScheduleData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    return knex.transaction(async (trx) => {
      const existing = await scopedTable(trx, context.tenant, 'asset_maintenance_schedules')
        .where({ schedule_id: scheduleId })
        .forUpdate()
        .first();
      if (!existing) {
        throw new NotFoundError('Maintenance schedule not found');
      }
      this.assertCustomRecurrence(data.frequency ?? existing.frequency, data.schedule_config ?? existing.schedule_config);

      const [schedule] = await scopedTable(trx, context.tenant, 'asset_maintenance_schedules')
        .where({ schedule_id: scheduleId })
        .update({ ...data, updated_at: new Date() })
        .returning('*');

      if (data.next_maintenance) {
        await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences')
          .where({ schedule_id: scheduleId, status: 'open' })
          .update({ due_date: data.next_maintenance, updated_at: new Date() });
      }
      if (data.next_maintenance || data.schedule_name || data.maintenance_type) {
        await scopedTable(trx, context.tenant, 'asset_maintenance_notifications')
          .where({ schedule_id: scheduleId, is_sent: false })
          .update({
            notification_date: schedule.next_maintenance,
            notification_data: trx.raw(
              "notification_data || ?::jsonb",
              [JSON.stringify({ schedule_name: schedule.schedule_name, maintenance_type: schedule.maintenance_type })]
            )
          });
      }
      if (data.is_active === false && existing.is_active) {
        await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences')
          .where({ schedule_id: scheduleId, status: 'open' })
          .update({ status: 'cancelled', closed_at: new Date(), closed_by: context.userId, updated_at: new Date() });
      } else if (data.is_active === true && !existing.is_active && !schedule.archived_at) {
        await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences')
          .insert({
            tenant: context.tenant, schedule_id: scheduleId, asset_id: schedule.asset_id,
            due_date: schedule.next_maintenance, status: 'open'
          })
          .onConflict().ignore();
      }
      return schedule;
    });
  }

  async deleteMaintenanceSchedule(scheduleId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const deleted = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .del();

    if (!deleted) {
      throw new NotFoundError('Maintenance schedule not found');
    }
  }

  async recordMaintenance(assetId: string, data: RecordMaintenanceData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    await this.assertAssetExists(knex, context.tenant, assetId);
    const performedBy = data.performed_by ?? context.userId;
    await this.assertUserExists(knex, context.tenant, performedBy, 'Maintenance performer not found');
    await this.assertMaintenanceScheduleForAsset(knex, context.tenant, data.schedule_id, assetId);

    const performedAt = data.performed_at ?? new Date().toISOString();
    // Only these columns exist on asset_maintenance_history; the loose fields
    // (duration/cost/notes/parts) live inside the maintenance_data jsonb.
    const extras: Record<string, unknown> = { ...(data.maintenance_data ?? {}) };
    if (data.duration_hours !== undefined) extras.duration_hours = data.duration_hours;
    if (data.cost !== undefined) extras.cost = data.cost;
    if (data.notes !== undefined) extras.notes = data.notes;
    if (data.parts_used !== undefined) extras.parts_used = data.parts_used;

    // Supplying occurrence_id gives REST clients the same double-tap semantics
    // as the desktop completion action: retries address the original row and
    // fail once it has closed. Older clients still select the current open
    // occurrence by schedule for backwards compatibility.
    return knex.transaction(async (trx) => {
      const schedule = await scopedTable(trx, context.tenant, 'asset_maintenance_schedules')
        .where({ schedule_id: data.schedule_id, asset_id: assetId, is_active: true })
        .forUpdate()
        .first();
      if (!schedule || schedule.archived_at) throw new ConflictError('Maintenance schedule is inactive');
      const occurrenceQuery = scopedTable(trx, context.tenant, 'asset_maintenance_occurrences')
        .where({ schedule_id: data.schedule_id, asset_id: assetId });
      if (data.occurrence_id) {
        occurrenceQuery.where({ occurrence_id: data.occurrence_id });
      } else {
        occurrenceQuery.where({ status: 'open' });
      }
      const occurrence = await occurrenceQuery.forUpdate().first();
      if (!occurrence || occurrence.status !== 'open') {
        throw new ConflictError('Maintenance occurrence has already been closed');
      }
      const row = {
        tenant: context.tenant, asset_id: assetId, schedule_id: data.schedule_id,
        maintenance_type: data.maintenance_type,
        description: data.description ?? data.notes ?? `${data.maintenance_type} maintenance performed`,
        maintenance_data: JSON.stringify(extras), performed_at: performedAt,
        performed_by: performedBy, created_at: new Date()
      };
      const [maintenance] = await scopedTable(trx, context.tenant, 'asset_maintenance_history').insert(row).returning('*');
      const nextMaintenance = this.calculateNextMaintenanceDate(performedAt, schedule.frequency, schedule.frequency_interval, schedule.schedule_config);
      await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences').where({ occurrence_id: occurrence.occurrence_id, status: 'open' }).update({ status: 'completed', history_id: maintenance.history_id, closed_at: new Date(), closed_by: performedBy, updated_at: new Date() });
      await scopedTable(trx, context.tenant, 'asset_maintenance_schedules').where({ schedule_id: data.schedule_id }).update({ last_maintenance: performedAt, next_maintenance: nextMaintenance, updated_at: new Date() });
      await scopedTable(trx, context.tenant, 'asset_maintenance_occurrences').insert({ tenant: context.tenant, schedule_id: schedule.schedule_id, asset_id: assetId, due_date: nextMaintenance, status: 'open' });
      return maintenance;
    });
  }

  async getMaintenanceHistory(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, 'asset_maintenance_history')
      .where({
        'asset_maintenance_history.asset_id': assetId
      })
      .select(
        'asset_maintenance_history.*',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as performed_by_user_name`)
      )
      .orderBy('performed_at', 'desc');
    tenantDb(knex, context.tenant).tenantJoin(query, 'users', 'asset_maintenance_history.performed_by', 'users.user_id', {
      type: 'left',
    });
    return query;
  }

  // Search and export
  async search(searchData: AssetSearchData, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const query = db.table(this.tableName);

    // Build search query
    const tableName = this.tableName;
    if (searchData.fields && searchData.fields.length > 0) {
      query.where(function() {
        searchData.fields!.forEach(field => {
          if (field === 'client_name') {
            this.orWhere('clients.client_name', 'ilike', `%${searchData.query}%`);
          } else {
            this.orWhere(`${tableName}.${field}`, 'ilike', `%${searchData.query}%`);
          }
        });
      });
    } else {
      // Default search across all text fields
      query.where(function() {
        this.orWhere(`${tableName}.asset_tag`, 'ilike', `%${searchData.query}%`)
          .orWhere(`${tableName}.name`, 'ilike', `%${searchData.query}%`)
          .orWhere(`${tableName}.serial_number`, 'ilike', `%${searchData.query}%`)
          .orWhere(`${tableName}.location`, 'ilike', `%${searchData.query}%`);
      });
    }

    // Apply filters
    if (searchData.asset_types && searchData.asset_types.length > 0) {
      query.whereIn(`${this.tableName}.asset_type`, searchData.asset_types);
    }
    if (searchData.statuses && searchData.statuses.length > 0) {
      query.whereIn(`${this.tableName}.status`, searchData.statuses);
    }
    if (searchData.client_ids && searchData.client_ids.length > 0) {
      query.whereIn(`${this.tableName}.client_id`, searchData.client_ids);
    }

    // Add joins for searching
    db.tenantJoin(query, 'clients', 'assets.client_id', 'clients.client_id', { type: 'left' });
    query
      .select(`${this.tableName}.*`, 'clients.client_name')
      .limit(searchData.limit || 25);

    const assets = await query;

    // Include extension data if requested
    if (searchData.include_extension_data) {
      return Promise.all(assets.map(async asset => ({
        ...asset,
        extension_data: await this.getAssetExtensionData(asset.asset_id, asset.asset_type, context)
      })));
    }

    return assets;
  }

  /** FR-C8: the asset's assignment history, newest first. */
  async getAssetAssignments(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, 'asset_assignments as aa')
      .where({ 'aa.asset_id': assetId })
      .select(
        'aa.assignment_id',
        'aa.asset_id',
        'aa.contact_name_id',
        'aa.assigned_at',
        'aa.assigned_by_user_id',
        'aa.unassigned_at',
        'aa.unassigned_by_user_id',
        'aa.source',
        'aa.note',
        'contacts.full_name as contact_name',
      );
    tenantDb(knex, context.tenant).tenantJoin(query, 'contacts', 'contacts.contact_name_id', 'aa.contact_name_id', {
      type: 'left',
    });

    return query.orderBy('aa.assigned_at', 'desc');
  }

  /** FR-B4: the tenant's asset statuses, in display order. */
  async listAssetStatuses(
    context: ServiceContext,
    options?: { includeArchived?: boolean }
  ): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, 'asset_statuses').select('*');
    if (!options?.includeArchived) query.where({ is_active: true });
    return query.orderBy('display_order', 'asc').orderBy('label', 'asc');
  }

  // Statistics
  async getStatistics(context: ServiceContext): Promise<any> {
    const [basicStats, typeStats, statusStats, clientStats, warrantyStats, maintenanceStats] = await Promise.all([
      this.getBasicStatistics(context),
      this.getAssetsByType(context),
      this.getAssetsByStatus(context),
      this.getAssetsByClient(context),
      this.getWarrantyStatistics(context),
      this.getMaintenanceStatistics(context)
    ]);

    return {
      ...basicStats,
      assets_by_type: typeStats,
      assets_by_status: statusStats,
      assets_by_client: clientStats,
      ...warrantyStats,
      ...maintenanceStats
    };
  }

  // Helper methods
  private getExtensionTableName(assetType: string): string | null {
    const tableMap: Record<string, string> = {
      'workstation': 'workstation_assets',
      'network_device': 'network_device_assets',
      'server': 'server_assets',
      'mobile_device': 'mobile_device_assets',
      'printer': 'printer_assets'
    };
    return tableMap[assetType] || null;
  }

  // Shared with the UI actions so both paths advance schedules identically.
  private calculateNextMaintenanceDate(startDate: string, frequency: string, interval?: number, scheduleConfig?: unknown): Date {
    try {
      return advanceMaintenanceDate(startDate, frequency, interval || 1, scheduleConfig);
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  }

  private assertCustomRecurrence(frequency: string | undefined, scheduleConfig: unknown): void {
    if (frequency !== 'custom') return;
    try {
      parseCustomRecurrence(scheduleConfig);
    } catch (error) {
      throw new ValidationError((error as Error).message);
    }
  }

  private async updateScheduleAfterMaintenance(scheduleId: string, performedAt: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    const schedule = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .first();

    if (schedule) {
      const nextMaintenance = this.calculateNextMaintenanceDate(
        performedAt,
        schedule.frequency,
        schedule.frequency_interval,
        schedule.schedule_config
      );

      await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
        .where({ schedule_id: scheduleId })
        .update({
          last_maintenance: performedAt,
          next_maintenance: nextMaintenance,
          updated_at: new Date()
        });
    }
  }

  private async getAssetClient(clientId: string, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    return scopedTable(knex, context.tenant, 'clients')
      .where({ client_id: clientId })
      // clients holds only client_name/url/billing_email; contact email/phone
      // live on the client's locations/contacts, not here.
      .select('client_id', 'client_name', 'billing_email')
      .first();
  }

  private async getBasicStatistics(context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const stats = await scopedTable(knex, context.tenant, this.tableName)
      .select([
        knex.raw('COUNT(*) as total_assets'),
        knex.raw(`COUNT(CASE WHEN created_at >= date_trunc('month', NOW()) THEN 1 END) as assets_added_this_month`),
        knex.raw('AVG(EXTRACT(DAYS FROM NOW() - purchase_date)) as average_asset_age_days'),
        knex.raw('SUM(COALESCE(purchase_price, 0)) as total_asset_value')
      ])
      .first();

    // FR-B5: "deployed" is every status whose kind is `deployable`, so a
    // tenant's custom "In use" counts and the literal `active` slug does not
    // have to be special.
    const deployed = await scopedTable(knex, context.tenant, this.tableName)
      .whereIn(
        'status',
        scopedTable(knex, context.tenant, 'asset_statuses').where({ kind: 'deployable' }).select('slug')
      )
      .count<{ count: string }>('asset_id as count')
      .first();

    return {
      total_assets: parseInt(stats?.total_assets || '0'),
      deployed_assets: parseInt(String(deployed?.count ?? '0')),
      assets_added_this_month: parseInt(stats?.assets_added_this_month || '0'),
      average_asset_age_days: stats?.average_asset_age_days ? Math.round(parseFloat(stats.average_asset_age_days)) : null,
      total_asset_value: parseFloat(stats?.total_asset_value || '0')
    };
  }

  private async getAssetsByType(context: ServiceContext): Promise<Record<string, number>> {
    const knex = await this.getDbForContext(context);
    const results = await scopedTable(knex, context.tenant, this.tableName)
      .groupBy('asset_type')
      .select('asset_type', knex.raw('COUNT(*) as count'));

    return results.reduce((acc, item) => {
      acc[item.asset_type] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getAssetsByStatus(context: ServiceContext): Promise<Record<string, number>> {
    const knex = await this.getDbForContext(context);
    const results = await scopedTable(knex, context.tenant, this.tableName)
        .groupBy('status')
        .select('status', knex.raw('COUNT(*) as count'));
  
      return results.reduce((acc, item) => {
        const status = item.status ?? 'Unknown';
        acc[status] = parseInt(item.count);
        return acc;
      }, {} as Record<string, number>);
    }


  private async getAssetsByClient(context: ServiceContext): Promise<Record<string, number>> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const query = db.table(this.tableName);
    db.tenantJoin(query, 'clients', 'assets.client_id', 'clients.client_id');
    const results = await query
      .groupBy('clients.client_name')
      .select('clients.client_name', knex.raw('COUNT(*) as count'))
      .limit(10) as unknown as Array<{ client_name: string; count: string }>;

    return results.reduce((acc, item) => {
      acc[item.client_name] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getWarrantyStatistics(context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const stats = await scopedTable(knex, context.tenant, this.tableName)
      .select([
        knex.raw(`COUNT(CASE WHEN warranty_end_date < NOW() + INTERVAL '30 days' AND warranty_end_date >= NOW() THEN 1 END) as warranty_expiring_soon`),
        knex.raw(`COUNT(CASE WHEN warranty_end_date < NOW() THEN 1 END) as warranty_expired`)
      ])
      .first();

    return {
      warranty_expiring_soon: parseInt(stats?.warranty_expiring_soon || '0'),
      warranty_expired: parseInt(stats?.warranty_expired || '0')
    };
  }

  private async getMaintenanceStatistics(context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const stats = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .select([
        knex.raw(`COUNT(CASE WHEN next_maintenance <= NOW() AND is_active = true THEN 1 END) as maintenance_due`),
        knex.raw(`COUNT(CASE WHEN next_maintenance < NOW() - INTERVAL '7 days' AND is_active = true THEN 1 END) as maintenance_overdue`)
      ])
      .first();

    return {
      maintenance_due: parseInt(stats?.maintenance_due || '0'),
      maintenance_overdue: parseInt(stats?.maintenance_overdue || '0')
    };
  }
}
