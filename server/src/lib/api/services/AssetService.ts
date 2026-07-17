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
  PrinterAssetData
} from '../schemas/asset';
import { publishEvent } from 'server/src/lib/eventBus/publishers';
import { NotFoundError, ConflictError, ValidationError } from '../middleware/apiMiddleware';

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
      searchableFields: ['asset_tag', 'name', 'serial_number', 'location'],
      defaultSort: 'created_at',
      defaultOrder: 'desc'
    });
  }

  async list(options: ListOptions, context: ServiceContext, filters?: AssetFilterData): Promise<ListResult<any>> {
    const knex = await this.getDbForContext(context);
    const query = scopedTable(knex, context.tenant, this.tableName);

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
      if (filters.purchase_date_from) {
        query.where(`${this.tableName}.purchase_date`, '>=', filters.purchase_date_from);
      }
      if (filters.purchase_date_to) {
        query.where(`${this.tableName}.purchase_date`, '<=', filters.purchase_date_to);
      }
      if (filters.warranty_end_from) {
        query.where(`${this.tableName}.warranty_end_date`, '>=', filters.warranty_end_from);
      }
      if (filters.warranty_end_to) {
        query.where(`${this.tableName}.warranty_end_date`, '<=', filters.warranty_end_to);
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
    query
      .select(
        `${this.tableName}.*`,
        'clients.client_name',
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
      // Apply the same filters to count query
      if (filters.client_id) {
        countQuery.where(`${this.tableName}.client_id`, filters.client_id);
      }
      if (filters.location_id) {
        countQuery.where(`${this.tableName}.location_id`, filters.location_id);
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
      
    const asset = await query.select(
        `${this.tableName}.*`,
        'clients.client_name',
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

    return asset || null;
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
    const { extension_data, ...assetData } = data;
    const knex = await this.getDbForContext(context);

    if (assetData.location_id) {
      await this.assertLocationBelongsToClient(knex, context.tenant, assetData.client_id, assetData.location_id);
    }
    
    const assetRecord = {
      ...assetData,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    const [asset] = await scopedTable(knex, context.tenant, this.tableName)
      .insert(assetRecord)
      .returning('*');

    // Handle extension data if provided
    if (extension_data && Object.keys(extension_data).length > 0) {
      await this.upsertExtensionData(asset.asset_id, asset.asset_type, extension_data, context);
    }

    // Publish event
    await publishEvent({
      eventType: 'ASSET_CREATED',
      payload: {
        tenantId: context.tenant,
        assetId: asset.asset_id,
        userId: context.userId,
        timestamp: new Date().toISOString()
      }
    });

    return this.getWithDetails(asset.asset_id, context);
  }

  async update(id: string, data: UpdateAssetData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const updateData: Record<string, unknown> = { ...data };

    const needsCurrent =
      data.location_id !== undefined ||
      data.client_id !== undefined;

    const current = needsCurrent
      ? await scopedTable(knex, context.tenant, this.tableName)
          .where({ [this.primaryKey]: id })
          .first('client_id', 'location_id')
      : null;

    if (needsCurrent && !current) {
      throw new NotFoundError('Asset not found');
    }

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

    updateData.updated_at = new Date();

    const updated = await scopedTable(knex, context.tenant, this.tableName)
      .where({ [this.primaryKey]: id })
      .update(updateData);

    if (!updated) {
      throw new NotFoundError('Asset not found');
    }

    // Publish event
    await publishEvent({
      eventType: 'ASSET_UPDATED',
      payload: {
        tenantId: context.tenant,
        assetId: id,
        userId: context.userId,
        changes: data,
        timestamp: new Date().toISOString()
      }
    });

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

  async upsertExtensionData(assetId: string, assetType: string, data: any, context: ServiceContext): Promise<void> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return;

    const extensionData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      updated_at: new Date()
    };

    // Check if record exists
    const knex = await this.getDbForContext(context);
    const existing = await scopedTable(knex, context.tenant, tableName)
      .where({ asset_id: assetId })
      .first();

    if (existing) {
      await scopedTable(knex, context.tenant, tableName)
        .where({ asset_id: assetId })
        .update(extensionData);
    } else {
      extensionData.created_at = new Date();
      await scopedTable(knex, context.tenant, tableName).insert(extensionData);
    }
  }

  async deleteExtensionData(assetId: string, assetType: string, context: ServiceContext): Promise<void> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return;

    const knex = await this.getDbForContext(context);
    await scopedTable(knex, context.tenant, tableName)
      .where({ asset_id: assetId })
      .del();
  }

  // Asset relationships
  async getAssetRelationships(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const db = tenantDb(knex, context.tenant);
    const query = db.table('asset_relationships');
    db.tenantJoin(query, 'assets as related_assets', 'asset_relationships.related_asset_id', 'related_assets.asset_id');
    return query
      .where({
        'asset_relationships.asset_id': assetId
      })
      .select(
        'asset_relationships.*',
        'related_assets.asset_tag',
        'related_assets.name as related_asset_name',
        'related_assets.asset_type',
        'related_assets.status'
      );
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
    return query
      .where({
        'document_associations.entity_type': 'asset',
        'document_associations.entity_id': assetId
      })
      .select(
        'document_associations.*',
        'documents.original_filename',
        'documents.file_size',
        'documents.mime_type',
        'documents.uploaded_at'
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
    await this.assertAssetExists(knex, context.tenant, assetId);
    if (data.assigned_to) {
      await this.assertUserExists(knex, context.tenant, data.assigned_to, 'Assigned user not found');
    }

    const scheduleData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    // Calculate next maintenance date
    (scheduleData as any).next_maintenance = this.calculateNextMaintenanceDate(
      data.start_date || new Date().toISOString(), 
      data.frequency, 
      data.frequency_interval
    );

    const [schedule] = await tenantDb(knex, context.tenant).table('asset_maintenance_schedules')
      .insert(scheduleData)
      .returning('*');

    return schedule;
  }

  async updateMaintenanceSchedule(scheduleId: string, data: UpdateMaintenanceScheduleData, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const existing = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .first();

    if (!existing) {
      throw new NotFoundError('Maintenance schedule not found');
    }

    if (data.assigned_to) {
      await this.assertUserExists(knex, context.tenant, data.assigned_to, 'Assigned user not found');
    }

    const updateData = {
      ...data,
      updated_at: new Date()
    };

    // Recalculate next maintenance if frequency changed
    if (data.frequency || data.frequency_interval || data.start_date) {
      const startDate = data.start_date || existing.start_date;
      const frequency = data.frequency || existing.frequency;
      const interval = data.frequency_interval || existing.frequency_interval;
      (updateData as any).next_maintenance = this.calculateNextMaintenanceDate(startDate, frequency, interval);
    }

    const updated = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .update(updateData);

    if (!updated) {
      throw new NotFoundError('Maintenance schedule not found');
    }

    const schedule = await scopedTable(knex, context.tenant, 'asset_maintenance_schedules')
      .where({ schedule_id: scheduleId })
      .first();

    if (!schedule) {
      throw new NotFoundError('Maintenance schedule not found');
    }

    return schedule;
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
    await this.assertUserExists(knex, context.tenant, data.performed_by, 'Maintenance performer not found');
    if (data.schedule_id) {
      await this.assertMaintenanceScheduleForAsset(knex, context.tenant, data.schedule_id, assetId);
    }

    const maintenanceData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      created_at: new Date()
    };

    const [maintenance] = await tenantDb(knex, context.tenant).table('asset_maintenance_history')
      .insert(maintenanceData)
      .returning('*');

    // Update schedule if linked
    if (data.schedule_id) {
      await this.updateScheduleAfterMaintenance(data.schedule_id, data.performed_at, context);
    }

    return maintenance;
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

  private calculateNextMaintenanceDate(startDate: string, frequency: string, interval?: number): Date {
    const start = new Date(startDate);
    const intervalValue = interval || 1;
    
    switch (frequency) {
      case 'daily':
        return new Date(start.getTime() + (intervalValue * 24 * 60 * 60 * 1000));
      case 'weekly':
        return new Date(start.getTime() + (intervalValue * 7 * 24 * 60 * 60 * 1000));
      case 'monthly':
        const monthly = new Date(start);
        monthly.setMonth(monthly.getMonth() + intervalValue);
        return monthly;
      case 'quarterly':
        const quarterly = new Date(start);
        quarterly.setMonth(quarterly.getMonth() + (intervalValue * 3));
        return quarterly;
      case 'yearly':
        const yearly = new Date(start);
        yearly.setFullYear(yearly.getFullYear() + intervalValue);
        return yearly;
      default:
        return start;
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
        schedule.frequency_interval
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

    return {
      total_assets: parseInt(stats?.total_assets || '0'),
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
