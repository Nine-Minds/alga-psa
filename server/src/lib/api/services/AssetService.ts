/**
 * Asset API Service
 * Handles all asset-related database operations for the REST API
 */

import { Knex } from 'knex';
import { BaseService, ServiceContext, ListOptions, ListResult } from './BaseService';
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
    const query = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

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
        query.join('clients', `${this.tableName}.client_id`, 'clients.client_id')
          .where('clients.client_name', 'ilike', `%${filters.client_name}%`);
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
    query.leftJoin('clients', `${this.tableName}.client_id`, 'clients.client_id')
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
    const countQuery = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

    if (filters) {
      // Apply the same filters to count query
      if (filters.client_id) {
        countQuery.where(`${this.tableName}.client_id`, filters.client_id);
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
    const query = knex(this.tableName)
      .leftJoin('clients', `${this.tableName}.client_id`, 'clients.client_id')
      .where({
        [`${this.tableName}.${this.primaryKey}`]: id,
        [`${this.tableName}.tenant`]: context.tenant
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

    const [client, extensionData, relationships, documents, maintenanceSchedules] = await Promise.all([
      this.getAssetClient(asset.client_id, context),
      this.getAssetExtensionData(id, asset.asset_type, context),
      this.getAssetRelationships(id, context),
      this.getAssetDocuments(id, context),
      this.getMaintenanceSchedules(id, context)
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
    
    const assetRecord = {
      ...assetData,
      tenant: context.tenant,
      created_at: new Date(),
      updated_at: new Date()
    };

    const knex = await this.getDbForContext(context);
    const [asset] = await knex(this.tableName)
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
    const updateData = {
      ...data,
      updated_at: new Date()
    };

    const knex = await this.getDbForContext(context);
    await knex(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
      .update(updateData);

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

    return this.getById(id, context);
  }

  async delete(id: string, context: ServiceContext): Promise<void> {
    // Get asset type for cleanup
    const asset = await this.getById(id, context);
    if (!asset) {
      throw new Error('Asset not found');
    }

    // Delete extension data
    await this.deleteExtensionData(id, asset.asset_type, context);

    const knex = await this.getDbForContext(context);

    // Delete external entity mapping (e.g., NinjaOne device mapping)
    await knex('tenant_external_entity_mappings')
      .where({ tenant: context.tenant, alga_entity_type: 'asset', alga_entity_id: id })
      .del();

    // Delete main asset record (cascade will handle relationships, documents, etc.)
    await knex(this.tableName)
      .where({ [this.primaryKey]: id, tenant: context.tenant })
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
    return knex(tableName)
      .where({ asset_id: assetId, tenant: context.tenant })
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
    const existing = await knex(tableName)
      .where({ asset_id: assetId, tenant: context.tenant })
      .first();

    if (existing) {
      await knex(tableName)
        .where({ asset_id: assetId, tenant: context.tenant })
        .update(extensionData);
    } else {
      extensionData.created_at = new Date();
      await knex(tableName).insert(extensionData);
    }
  }

  async deleteExtensionData(assetId: string, assetType: string, context: ServiceContext): Promise<void> {
    const tableName = this.getExtensionTableName(assetType);
    if (!tableName) return;

    const knex = await this.getDbForContext(context);
    await knex(tableName)
      .where({ asset_id: assetId, tenant: context.tenant })
      .del();
  }

  // Asset relationships
  async getAssetRelationships(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    return knex('asset_relationships')
      .join('assets as related_assets', 'asset_relationships.related_asset_id', 'related_assets.asset_id')
      .where({
        'asset_relationships.asset_id': assetId,
        'asset_relationships.tenant': context.tenant
      })
      .select(
        'asset_relationships.*',
        'related_assets.asset_tag',
        'related_assets.name as related_asset_name',
        'related_assets.asset_type',
        'related_assets.status'
      );
  }

  async createRelationship(assetId: string, data: CreateAssetRelationshipData, context: ServiceContext): Promise<any> {
    // Prevent circular relationships
    if (assetId === data.related_asset_id) {
      throw new Error('Cannot create relationship with self');
    }

    // Check for existing relationship
    const knex = await this.getDbForContext(context);
    const existing = await knex('asset_relationships')
      .where({
        asset_id: assetId,
        related_asset_id: data.related_asset_id,
        tenant: context.tenant
      })
      .first();

    if (existing) {
      throw new Error('Relationship already exists');
    }

    const relationshipData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      created_at: new Date()
    };

    const [relationship] = await knex('asset_relationships')
      .insert(relationshipData)
      .returning('*');

    return relationship;
  }

  async deleteRelationship(relationshipId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    await knex('asset_relationships')
      .where({ relationship_id: relationshipId, tenant: context.tenant })
      .del();
  }

  // Asset documents
  async getAssetDocuments(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    return knex('document_associations')
      .join('documents', 'document_associations.document_id', 'documents.document_id')
      .where({
        'document_associations.entity_type': 'asset',
        'document_associations.entity_id': assetId,
        'document_associations.tenant': context.tenant
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
    const associationData = {
      entity_type: 'asset',
      entity_id: assetId,
      document_id: data.document_id,
      notes: data.notes || null,
      tenant: context.tenant,
      created_at: new Date()
    };

    const knex = await this.getDbForContext(context);
    const [association] = await knex('document_associations')
      .insert(associationData)
      .returning('*');

    return association;
  }

  async removeDocumentAssociation(associationId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    await knex('document_associations')
      .where({ association_id: associationId, tenant: context.tenant })
      .del();
  }

  // Maintenance management
  async getMaintenanceSchedules(assetId: string, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    return knex('asset_maintenance_schedules')
      .leftJoin('users', 'asset_maintenance_schedules.assigned_to', 'users.user_id')
      .where({
        'asset_maintenance_schedules.asset_id': assetId,
        'asset_maintenance_schedules.tenant': context.tenant
      })
      .select(
        'asset_maintenance_schedules.*',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as assigned_user_name`)
      );
  }

  async createMaintenanceSchedule(assetId: string, data: CreateMaintenanceScheduleData, context: ServiceContext): Promise<any> {
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

    const knex = await this.getDbForContext(context);
    const [schedule] = await knex('asset_maintenance_schedules')
      .insert(scheduleData)
      .returning('*');

    return schedule;
  }

  async updateMaintenanceSchedule(scheduleId: string, data: UpdateMaintenanceScheduleData, context: ServiceContext): Promise<any> {
    const updateData = {
      ...data,
      updated_at: new Date()
    };

    // Recalculate next maintenance if frequency changed
    if (data.frequency || data.frequency_interval || data.start_date) {
      const knex = await this.getDbForContext(context);
      const existing = await knex('asset_maintenance_schedules')
        .where({ schedule_id: scheduleId, tenant: context.tenant })
        .first();
      
      if (existing) {
        const startDate = data.start_date || existing.start_date;
        const frequency = data.frequency || existing.frequency;
        const interval = data.frequency_interval || existing.frequency_interval;
        (updateData as any).next_maintenance = this.calculateNextMaintenanceDate(startDate, frequency, interval);
      }
    }

    const knex = await this.getDbForContext(context);
    await knex('asset_maintenance_schedules')
      .where({ schedule_id: scheduleId, tenant: context.tenant })
      .update(updateData);

    return knex('asset_maintenance_schedules')
      .where({ schedule_id: scheduleId, tenant: context.tenant })
      .first();
  }

  async deleteMaintenanceSchedule(scheduleId: string, context: ServiceContext): Promise<void> {
    const knex = await this.getDbForContext(context);
    await knex('asset_maintenance_schedules')
      .where({ schedule_id: scheduleId, tenant: context.tenant })
      .del();
  }

  async recordMaintenance(assetId: string, data: RecordMaintenanceData, context: ServiceContext): Promise<any> {
    const maintenanceData = {
      ...data,
      asset_id: assetId,
      tenant: context.tenant,
      created_at: new Date()
    };

    const knex = await this.getDbForContext(context);
    const [maintenance] = await knex('asset_maintenance_history')
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
    return knex('asset_maintenance_history')
      .leftJoin('users', 'asset_maintenance_history.performed_by', 'users.user_id')
      .where({
        'asset_maintenance_history.asset_id': assetId,
        'asset_maintenance_history.tenant': context.tenant
      })
      .select(
        'asset_maintenance_history.*',
        knex.raw(`CONCAT(users.first_name, ' ', users.last_name) as performed_by_user_name`)
      )
      .orderBy('performed_at', 'desc');
  }

  // Search and export
  async search(searchData: AssetSearchData, context: ServiceContext): Promise<any[]> {
    const knex = await this.getDbForContext(context);
    const query = knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant);

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
    query.leftJoin('clients', `${this.tableName}.client_id`, 'clients.client_id')
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
    const schedule = await knex('asset_maintenance_schedules')
      .where({ schedule_id: scheduleId, tenant: context.tenant })
      .first();

    if (schedule) {
      const nextMaintenance = this.calculateNextMaintenanceDate(
        performedAt,
        schedule.frequency,
        schedule.frequency_interval
      );

      await knex('asset_maintenance_schedules')
        .where({ schedule_id: scheduleId, tenant: context.tenant })
        .update({
          last_maintenance: performedAt,
          next_maintenance: nextMaintenance,
          updated_at: new Date()
        });
    }
  }

  private async getAssetClient(clientId: string, context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    return knex('clients')
      .where({ client_id: clientId, tenant: context.tenant })
      .select('client_id', 'client_name', 'email', 'phone_no')
      .first();
  }

  private async getBasicStatistics(context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const stats = await knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant)
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
    const results = await knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant)
      .groupBy('asset_type')
      .select('asset_type', knex.raw('COUNT(*) as count'));

    return results.reduce((acc, item) => {
      acc[item.asset_type] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getAssetsByStatus(context: ServiceContext): Promise<Record<string, number>> {
    const knex = await this.getDbForContext(context);
    const results = await knex(this.tableName)
        .where(`${this.tableName}.tenant`, context.tenant)
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
    const results = await knex(this.tableName)
      .join('clients', `${this.tableName}.client_id`, 'clients.client_id')
      .where(`${this.tableName}.tenant`, context.tenant)
      .groupBy('clients.client_name')
      .select('clients.client_name', knex.raw('COUNT(*) as count'))
      .limit(10);

    return results.reduce((acc, item) => {
      acc[item.client_name] = parseInt(item.count);
      return acc;
    }, {} as Record<string, number>);
  }

  private async getWarrantyStatistics(context: ServiceContext): Promise<any> {
    const knex = await this.getDbForContext(context);
    const stats = await knex(this.tableName)
      .where(`${this.tableName}.tenant`, context.tenant)
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
    const stats = await knex('asset_maintenance_schedules')
      .where('asset_maintenance_schedules.tenant', context.tenant)
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