/**
 * Asset repository - data access layer for assets
 *
 * This repository provides database operations for assets.
 * It uses the @alga-psa/database package for connection management.
 */

import type { Knex } from 'knex';
import type {
  Asset,
  CreateAssetInput,
  UpdateAssetInput,
  AssetFilters,
  AssetListResponse,
  AssetRelationship,
  CreateAssetRelationshipInput,
  WorkstationAsset,
  NetworkDeviceAsset,
  ServerAsset,
  MobileDeviceAsset,
  PrinterAsset,
} from '../types/index.js';

const TABLE_NAME = 'assets';

type AssetExtensionType = WorkstationAsset | NetworkDeviceAsset | ServerAsset | MobileDeviceAsset | PrinterAsset;

/**
 * Helper function to get extension table data
 */
async function getExtensionData(
  knex: Knex,
  tenant: string,
  asset_id: string,
  asset_type: string | undefined
): Promise<AssetExtensionType | null> {
  if (!asset_type) return null;

  const tableName = `${asset_type.toLowerCase()}_assets`;
  try {
    return await knex(tableName)
      .where({ tenant, asset_id })
      .first();
  } catch {
    return null;
  }
}

/**
 * Helper function to upsert extension table data
 */
async function upsertExtensionData(
  knex: Knex,
  tenant: string,
  asset_id: string,
  asset_type: string,
  data: unknown
): Promise<void> {
  if (!data || typeof data !== 'object') return;

  const tableName = `${asset_type.toLowerCase()}_assets`;
  const extensionData = { tenant, asset_id, ...data };

  const exists = await knex(tableName)
    .where({ tenant, asset_id })
    .first();

  if (exists) {
    await knex(tableName)
      .where({ tenant, asset_id })
      .update(extensionData);
  } else {
    await knex(tableName).insert(extensionData);
  }
}

/**
 * Helper function to delete extension table data
 */
async function deleteExtensionData(
  knex: Knex,
  tenant: string,
  asset_id: string,
  asset_type: string
): Promise<void> {
  const tableName = `${asset_type.toLowerCase()}_assets`;
  await knex(tableName)
    .where({ tenant, asset_id })
    .delete();
}

/**
 * Create the asset repository with database connection
 */
export function createAssetRepository(knex: Knex) {
  return {
    /**
     * Find an asset by ID
     */
    async findById(
      tenantId: string,
      assetId: string,
      includeExtensions = true
    ): Promise<Asset | null> {
      const asset = await knex(TABLE_NAME)
        .select(
          'assets.*',
          'clients.client_name'
        )
        .leftJoin('clients', function(this: Knex.JoinClause) {
          this.on('clients.client_id', '=', 'assets.client_id')
            .andOn('clients.tenant', '=', 'assets.tenant');
        })
        .where({ 'assets.tenant': tenantId, 'assets.asset_id': assetId })
        .first();

      if (!asset) {
        return null;
      }

      // Get extension data if requested
      const extensionData = includeExtensions
        ? await getExtensionData(knex, tenantId, assetId, asset.asset_type)
        : null;

      // Get relationships
      const relationships = await knex('asset_relationships')
        .where(function(this: Knex.QueryBuilder) {
          this.where('parent_asset_id', assetId)
            .orWhere('child_asset_id', assetId);
        })
        .andWhere({ tenant: tenantId });

      return {
        ...asset,
        client: asset.client_id ? {
          client_id: asset.client_id,
          client_name: asset.client_name || '',
        } : undefined,
        relationships: relationships || [],
        ...(extensionData ? { [asset.asset_type]: extensionData } : {}),
      };
    },

    /**
     * Find assets matching filters
     */
    async findMany(
      tenantId: string,
      filters: AssetFilters = {}
    ): Promise<AssetListResponse> {
      const {
        search,
        client_id,
        asset_type,
        status,
        location,
        page = 1,
        limit = 50,
        orderBy = 'created_at',
        orderDirection = 'desc',
        include_extension_data = false,
      } = filters;

      let query = knex(TABLE_NAME)
        .where('assets.tenant', tenantId)
        .leftJoin('clients', function(this: Knex.JoinClause) {
          this.on('clients.client_id', '=', 'assets.client_id')
            .andOn('clients.tenant', '=', 'assets.tenant');
        });

      // Apply filters
      if (search) {
        query = query.where((builder) => {
          builder
            .whereILike('assets.name', `%${search}%`)
            .orWhereILike('assets.asset_tag', `%${search}%`)
            .orWhereILike('assets.serial_number', `%${search}%`);
        });
      }

      if (client_id) {
        query = query.where({ 'assets.client_id': client_id });
      }

      if (asset_type) {
        query = query.where({ 'assets.asset_type': asset_type });
      }

      if (status) {
        query = query.where({ 'assets.status': status });
      }

      if (location) {
        query = query.whereILike('assets.location', `%${location}%`);
      }

      // Get total count
      const countResult = await query.clone().count('* as count').first();
      const total = Number(countResult?.count || 0);

      // Apply ordering and pagination
      const offset = (page - 1) * limit;
      const assets = await query
        .select('assets.*', 'clients.client_name')
        .orderBy(`assets.${orderBy}`, orderDirection)
        .limit(limit)
        .offset(offset);

      // Get extension data if requested
      const assetsWithExtensions = await Promise.all(
        assets.map(async (asset: any): Promise<Asset> => {
          const extensionData = include_extension_data
            ? await getExtensionData(knex, tenantId, asset.asset_id, asset.asset_type)
            : null;

          return {
            ...asset,
            client: asset.client_id ? {
              client_id: asset.client_id,
              client_name: asset.client_name || '',
            } : undefined,
            relationships: [],
            ...(extensionData ? { [asset.asset_type]: extensionData } : {}),
          };
        })
      );

      return { assets: assetsWithExtensions, total, page, limit };
    },

    /**
     * Create a new asset
     */
    async create(
      tenantId: string,
      userId: string,
      input: CreateAssetInput
    ): Promise<Asset> {
      const now = new Date().toISOString();

      // Extract extension data
      const { workstation, network_device, server, mobile_device, printer, ...baseAssetData } = input;

      // Create base asset
      const [asset] = await knex(TABLE_NAME)
        .insert({
          ...baseAssetData,
          tenant: tenantId,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      // Handle extension table data based on asset type
      const extensionDataMap: Record<string, unknown> = {
        workstation,
        network_device,
        server,
        mobile_device,
        printer,
      };

      const extensionData = extensionDataMap[input.asset_type];
      if (extensionData) {
        await upsertExtensionData(knex, tenantId, asset.asset_id, input.asset_type, extensionData);
      }

      // Create history record
      await knex('asset_history').insert({
        tenant: tenantId,
        asset_id: asset.asset_id,
        changed_by: userId,
        change_type: 'created',
        changes: input,
        changed_at: now,
      });

      // Return the complete asset with extension data
      return this.findById(tenantId, asset.asset_id) as Promise<Asset>;
    },

    /**
     * Update an existing asset
     */
    async update(
      tenantId: string,
      userId: string,
      assetId: string,
      input: UpdateAssetInput
    ): Promise<Asset | null> {
      const { workstation, network_device, server, mobile_device, printer, ...baseUpdateData } = input;

      // Update base asset
      const [asset] = await knex(TABLE_NAME)
        .where({ tenant: tenantId, asset_id: assetId })
        .update({
          ...baseUpdateData,
          updated_at: knex.fn.now(),
        })
        .returning('*');

      if (!asset) {
        return null;
      }

      // Handle extension data updates
      const extensionDataMap: Record<string, unknown> = {
        workstation,
        network_device,
        server,
        mobile_device,
        printer,
      };

      const newAssetType = input.asset_type || asset.asset_type;
      const extensionData = extensionDataMap[newAssetType];

      if (extensionData) {
        // If asset type changed, delete old extension data
        if (input.asset_type && input.asset_type !== asset.asset_type) {
          await deleteExtensionData(knex, tenantId, assetId, asset.asset_type);
        }
        await upsertExtensionData(knex, tenantId, assetId, newAssetType, extensionData);
      }

      // Create history record
      await knex('asset_history').insert({
        tenant: tenantId,
        asset_id: assetId,
        changed_by: userId,
        change_type: 'updated',
        changes: input,
        changed_at: knex.fn.now(),
      });

      return this.findById(tenantId, assetId);
    },

    /**
     * Delete an asset
     */
    async delete(tenantId: string, assetId: string): Promise<boolean> {
      const asset = await knex(TABLE_NAME)
        .where({ tenant: tenantId, asset_id: assetId })
        .first();

      if (!asset) {
        return false;
      }

      // Delete extension data
      await deleteExtensionData(knex, tenantId, assetId, asset.asset_type);

      // Delete related records
      await knex('asset_history').where({ tenant: tenantId, asset_id: assetId }).delete();
      await knex('asset_maintenance_history').where({ tenant: tenantId, asset_id: assetId }).delete();
      await knex('asset_maintenance_schedules').where({ tenant: tenantId, asset_id: assetId }).delete();
      await knex('asset_relationships')
        .where({ tenant: tenantId, parent_asset_id: assetId })
        .orWhere({ tenant: tenantId, child_asset_id: assetId })
        .delete();
      await knex('asset_associations').where({ tenant: tenantId, asset_id: assetId }).delete();
      await knex('document_associations')
        .where({ tenant: tenantId, entity_type: 'asset', entity_id: assetId })
        .delete();

      // Delete the asset
      const result = await knex(TABLE_NAME)
        .where({ tenant: tenantId, asset_id: assetId })
        .delete();

      return result > 0;
    },

    /**
     * Link two assets (create relationship)
     */
    async linkAssets(
      tenantId: string,
      input: CreateAssetRelationshipInput
    ): Promise<AssetRelationship> {
      const now = new Date().toISOString();

      const [relationship] = await knex('asset_relationships')
        .insert({
          tenant: tenantId,
          ...input,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      // Get the name of the child asset
      const childAsset = await knex(TABLE_NAME)
        .where({ tenant: tenantId, asset_id: input.child_asset_id })
        .first('name');

      return {
        ...relationship,
        name: childAsset?.name || '',
      };
    },

    /**
     * Get related assets
     */
    async getRelatedAssets(
      tenantId: string,
      assetId: string
    ): Promise<AssetRelationship[]> {
      const relationships = await knex('asset_relationships')
        .select('asset_relationships.*', 'assets.name')
        .leftJoin('assets', function(this: Knex.JoinClause) {
          this.on('assets.asset_id', '=', 'asset_relationships.child_asset_id')
            .andOn('assets.tenant', '=', 'asset_relationships.tenant');
        })
        .where(function(this: Knex.QueryBuilder) {
          this.where('asset_relationships.parent_asset_id', assetId)
            .orWhere('asset_relationships.child_asset_id', assetId);
        })
        .andWhere({ 'asset_relationships.tenant': tenantId });

      return relationships;
    },

    /**
     * Get asset history
     */
    async getHistory(
      tenantId: string,
      assetId: string
    ): Promise<any[]> {
      return knex('asset_history')
        .where({ tenant: tenantId, asset_id: assetId })
        .orderBy('changed_at', 'desc');
    },
  };
}

// Default export for convenience when used with dependency injection
export const assetRepository = {
  create: createAssetRepository,
};
