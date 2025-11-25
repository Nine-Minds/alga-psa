/**
 * NinjaOne Sync Engine
 *
 * Handles bidirectional synchronization of devices between NinjaOne and Alga PSA.
 * Supports full sync, incremental sync, and single device sync operations.
 */

import { Knex } from 'knex';
import { createTenantKnex } from '../../../../../../server/src/lib/db';
import { withTransaction } from '@shared/db';
import logger from '@shared/core/logger';
import { createNinjaOneClient, NinjaOneClient } from '../ninjaOneClient';
import {
  mapDevice,
  mapDeviceToAssetBase,
  mapToWorkstationExtension,
  mapToServerExtension,
  mapToNetworkDeviceExtension,
  determineAssetType,
  calculateAssetChanges,
  DeviceMappingResult,
} from '../mappers/deviceMapper';
import {
  NinjaOneDevice,
  NinjaOneDeviceDetail,
  NinjaOneOrganization,
} from '../../../../interfaces/ninjaone.interfaces';
import {
  RmmIntegration,
  RmmOrganizationMapping,
  RmmSyncResult,
  RmmSyncStatus,
} from '../../../../interfaces/rmm.interfaces';
import {
  Asset,
  CreateAssetRequest,
} from '../../../../../../server/src/interfaces/asset.interfaces';
import { publishEvent } from '@shared/workflow/streams/eventPublisher';

/**
 * Sync operation options
 */
export interface SyncOptions {
  /** Only sync specific organization IDs */
  organizationIds?: number[];
  /** Force full refresh even for incremental sync */
  forceRefresh?: boolean;
  /** Batch size for processing devices */
  batchSize?: number;
  /** User ID performing the sync (for audit) */
  performedBy?: string;
}

/**
 * Device sync item result
 */
export interface DeviceSyncItem {
  deviceId: number;
  deviceName: string;
  assetId?: string;
  action: 'created' | 'updated' | 'skipped' | 'failed';
  error?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

/**
 * Sync progress callback
 */
export type SyncProgressCallback = (progress: {
  phase: 'organizations' | 'devices' | 'cleanup';
  current: number;
  total: number;
  message: string;
}) => void;

/**
 * NinjaOne Sync Engine
 *
 * Responsible for synchronizing devices from NinjaOne to Alga PSA assets.
 */
export class NinjaOneSyncEngine {
  private tenantId: string;
  private integrationId: string;
  private client: NinjaOneClient | null = null;
  private knex: Knex | null = null;
  private isRunning = false;
  private abortController: AbortController | null = null;

  constructor(tenantId: string, integrationId: string) {
    this.tenantId = tenantId;
    this.integrationId = integrationId;
  }

  /**
   * Initialize the sync engine (lazy loading)
   */
  private async initialize(): Promise<void> {
    if (!this.client) {
      this.client = await createNinjaOneClient(this.tenantId, this.integrationId);
    }
    if (!this.knex) {
      const { knex } = await createTenantKnex();
      this.knex = knex;
    }
  }

  /**
   * Check if sync is currently running
   */
  public isSyncRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Abort a running sync operation
   */
  public abortSync(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Run a full sync of all devices from mapped organizations
   */
  public async runFullSync(
    options: SyncOptions = {},
    onProgress?: SyncProgressCallback
  ): Promise<RmmSyncResult> {
    if (this.isRunning) {
      throw new Error('Sync is already in progress');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    const startTime = Date.now();
    const result: RmmSyncResult = {
      success: true,
      sync_type: 'full',
      started_at: new Date().toISOString(),
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      errors: [],
    };

    try {
      await this.initialize();

      // Emit sync started event
      await this.emitSyncStartedEvent('full');

      // Update integration sync status
      await this.updateSyncStatus('syncing');

      // Get organization mappings
      const mappings = await this.getOrganizationMappings(options.organizationIds);

      if (mappings.length === 0) {
        logger.warn('No organization mappings found for sync', {
          tenantId: this.tenantId,
          integrationId: this.integrationId,
        });
        result.errors?.push('No organization mappings configured');
        return result;
      }

      logger.info('Starting full NinjaOne sync', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        organizationCount: mappings.length,
      });

      const batchSize = options.batchSize || 50;
      let totalDevices = 0;
      let processedDevices = 0;

      // Process each organization
      for (let i = 0; i < mappings.length; i++) {
        if (this.abortController?.signal.aborted) {
          result.errors?.push('Sync aborted by user');
          break;
        }

        const mapping = mappings[i];

        onProgress?.({
          phase: 'organizations',
          current: i + 1,
          total: mappings.length,
          message: `Syncing organization: ${mapping.external_org_name || mapping.external_org_id}`,
        });

        try {
          // Get all devices for this organization
          const devices = await this.client!.getDevices({
            organizationId: parseInt(mapping.external_org_id, 10),
          });

          totalDevices += devices.length;

          // Process devices in batches
          for (let j = 0; j < devices.length; j += batchSize) {
            if (this.abortController?.signal.aborted) break;

            const batch = devices.slice(j, j + batchSize);
            const batchResults = await this.processBatch(batch, mapping);

            // Aggregate results
            for (const item of batchResults) {
              result.items_processed++;
              processedDevices++;

              switch (item.action) {
                case 'created':
                  result.items_created++;
                  break;
                case 'updated':
                  result.items_updated++;
                  break;
                case 'failed':
                  result.items_failed++;
                  if (item.error) {
                    result.errors?.push(`Device ${item.deviceName}: ${item.error}`);
                  }
                  break;
              }

              onProgress?.({
                phase: 'devices',
                current: processedDevices,
                total: totalDevices,
                message: `Processed: ${item.deviceName}`,
              });
            }
          }

          // Update organization mapping last synced
          await this.updateOrganizationMappingLastSynced(mapping.mapping_id);

        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error('Failed to sync organization', {
            tenantId: this.tenantId,
            integrationId: this.integrationId,
            organizationId: mapping.external_org_id,
            error: message,
          });
          result.errors?.push(`Organization ${mapping.external_org_name}: ${message}`);
        }
      }

      // Handle deleted devices (cleanup)
      if (!this.abortController?.signal.aborted) {
        onProgress?.({
          phase: 'cleanup',
          current: 0,
          total: 1,
          message: 'Checking for deleted devices...',
        });

        const deletedCount = await this.handleDeletedDevices(mappings);
        result.items_deleted = deletedCount;
      }

      // Update final status
      result.completed_at = new Date().toISOString();
      result.success = result.items_failed === 0 && !result.errors?.length;

      // Update integration record
      await this.updateIntegrationAfterSync(result);

      // Emit sync completed event
      await this.emitSyncCompletedEvent(result);

      logger.info('Full NinjaOne sync completed', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        duration: Date.now() - startTime,
        result,
      });

      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.success = false;
      result.completed_at = new Date().toISOString();
      result.errors?.push(message);

      await this.updateSyncStatus('error', message);
      await this.emitSyncFailedEvent(message);

      logger.error('Full NinjaOne sync failed', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        error: message,
      });

      return result;

    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Run an incremental sync (only changed devices since last sync)
   */
  public async runIncrementalSync(
    since: Date,
    options: SyncOptions = {},
    onProgress?: SyncProgressCallback
  ): Promise<RmmSyncResult> {
    if (this.isRunning) {
      throw new Error('Sync is already in progress');
    }

    this.isRunning = true;
    this.abortController = new AbortController();

    const startTime = Date.now();
    const result: RmmSyncResult = {
      success: true,
      sync_type: 'incremental',
      started_at: new Date().toISOString(),
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      errors: [],
    };

    try {
      await this.initialize();

      await this.emitSyncStartedEvent('incremental');
      await this.updateSyncStatus('syncing');

      const mappings = await this.getOrganizationMappings(options.organizationIds);

      if (mappings.length === 0) {
        result.errors?.push('No organization mappings configured');
        return result;
      }

      logger.info('Starting incremental NinjaOne sync', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        since: since.toISOString(),
        organizationCount: mappings.length,
      });

      // For incremental sync, we fetch all devices and filter by lastContact
      // NinjaOne doesn't have a "modified since" filter, so we use lastContact
      const batchSize = options.batchSize || 50;

      for (const mapping of mappings) {
        if (this.abortController?.signal.aborted) break;

        try {
          const devices = await this.client!.getDevices({
            organizationId: parseInt(mapping.external_org_id, 10),
          });

          // Filter devices that have been contacted since the last sync
          const changedDevices = devices.filter(d => {
            if (!d.lastContact) return true; // New devices
            return new Date(d.lastContact) > since;
          });

          onProgress?.({
            phase: 'devices',
            current: 0,
            total: changedDevices.length,
            message: `Found ${changedDevices.length} changed devices in ${mapping.external_org_name}`,
          });

          for (let j = 0; j < changedDevices.length; j += batchSize) {
            if (this.abortController?.signal.aborted) break;

            const batch = changedDevices.slice(j, j + batchSize);
            const batchResults = await this.processBatch(batch, mapping);

            for (const item of batchResults) {
              result.items_processed++;
              switch (item.action) {
                case 'created':
                  result.items_created++;
                  break;
                case 'updated':
                  result.items_updated++;
                  break;
                case 'failed':
                  result.items_failed++;
                  if (item.error) {
                    result.errors?.push(`Device ${item.deviceName}: ${item.error}`);
                  }
                  break;
              }
            }
          }

          await this.updateOrganizationMappingLastSynced(mapping.mapping_id);

        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors?.push(`Organization ${mapping.external_org_name}: ${message}`);
        }
      }

      result.completed_at = new Date().toISOString();
      result.success = result.items_failed === 0 && !result.errors?.length;

      await this.updateIntegrationAfterSync(result, true);
      await this.emitSyncCompletedEvent(result);

      logger.info('Incremental NinjaOne sync completed', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        duration: Date.now() - startTime,
        result,
      });

      return result;

    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.success = false;
      result.completed_at = new Date().toISOString();
      result.errors?.push(message);

      await this.updateSyncStatus('error', message);
      await this.emitSyncFailedEvent(message);

      return result;

    } finally {
      this.isRunning = false;
      this.abortController = null;
    }
  }

  /**
   * Sync a single device by ID
   */
  public async syncDevice(deviceId: number): Promise<Asset> {
    await this.initialize();

    logger.debug('Syncing single device', {
      tenantId: this.tenantId,
      integrationId: this.integrationId,
      deviceId,
    });

    // Get device details from NinjaOne
    const device = await this.client!.getDevice(deviceId);

    // Find the organization mapping
    const mapping = await this.knex!('rmm_organization_mappings')
      .where({
        tenant: this.tenantId,
        integration_id: this.integrationId,
        external_org_id: String(device.organizationId),
      })
      .first<RmmOrganizationMapping>();

    if (!mapping || !mapping.client_id) {
      throw new Error(`No client mapping found for organization ${device.organizationId}`);
    }

    // Check for existing asset
    const existingMapping = await this.findAssetByDeviceId(deviceId);

    if (existingMapping) {
      // Update existing asset
      return await this.updateExistingAsset(existingMapping.alga_entity_id, device, mapping);
    } else {
      // Create new asset
      return await this.createNewAsset(device, mapping);
    }
  }

  /**
   * Sync a specific organization
   */
  public async syncOrganization(organizationId: number): Promise<RmmSyncResult> {
    return this.runFullSync({ organizationIds: [organizationId] });
  }

  /**
   * Process a batch of devices
   */
  private async processBatch(
    devices: NinjaOneDevice[],
    mapping: RmmOrganizationMapping
  ): Promise<DeviceSyncItem[]> {
    const results: DeviceSyncItem[] = [];

    for (const device of devices) {
      try {
        // Get detailed device info
        const deviceDetail = await this.client!.getDevice(device.id);

        // Check if asset already exists
        const existingMapping = await this.findAssetByDeviceId(device.id);

        if (existingMapping) {
          // Update existing asset
          const existingAsset = await this.getAssetById(existingMapping.alga_entity_id);
          if (existingAsset) {
            const changes = calculateAssetChanges(existingAsset, deviceDetail);

            if (Object.keys(changes).length > 0) {
              await this.updateExistingAsset(existingMapping.alga_entity_id, deviceDetail, mapping);
              results.push({
                deviceId: device.id,
                deviceName: device.displayName || device.systemName || `Device-${device.id}`,
                assetId: existingMapping.alga_entity_id,
                action: 'updated',
                changes,
              });
            } else {
              // Update last_seen_at even if no changes
              await this.updateAssetLastSeen(existingMapping.alga_entity_id, deviceDetail);
              results.push({
                deviceId: device.id,
                deviceName: device.displayName || device.systemName || `Device-${device.id}`,
                assetId: existingMapping.alga_entity_id,
                action: 'skipped',
              });
            }
          }
        } else {
          // Create new asset
          if (!mapping.client_id) {
            results.push({
              deviceId: device.id,
              deviceName: device.displayName || device.systemName || `Device-${device.id}`,
              action: 'failed',
              error: 'Organization not mapped to a client',
            });
            continue;
          }

          const newAsset = await this.createNewAsset(deviceDetail, mapping);
          results.push({
            deviceId: device.id,
            deviceName: device.displayName || device.systemName || `Device-${device.id}`,
            assetId: newAsset.asset_id,
            action: 'created',
          });

          // Emit device created event
          await this.emitDeviceCreatedEvent(newAsset, deviceDetail);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          deviceId: device.id,
          deviceName: device.displayName || device.systemName || `Device-${device.id}`,
          action: 'failed',
          error: message,
        });
      }
    }

    return results;
  }

  /**
   * Create a new asset from NinjaOne device
   */
  private async createNewAsset(
    device: NinjaOneDeviceDetail,
    mapping: RmmOrganizationMapping
  ): Promise<Asset> {
    const mappingResult = mapDevice(device, mapping.client_id!, this.integrationId);

    if (!mappingResult.success || !mappingResult.createRequest) {
      throw new Error(mappingResult.error || 'Failed to map device to asset');
    }

    const createRequest = mappingResult.createRequest;

    // Add RMM-specific fields that aren't in CreateAssetRequest
    const baseAssetData = mappingResult.baseFields!;

    return await withTransaction(this.knex!, async (trx: Knex.Transaction) => {
      const now = new Date().toISOString();

      // Insert base asset
      const [asset] = await trx('assets')
        .insert({
          tenant: this.tenantId,
          asset_type: createRequest.asset_type,
          client_id: createRequest.client_id,
          asset_tag: createRequest.asset_tag,
          name: createRequest.name,
          status: createRequest.status,
          location: createRequest.location || '',
          serial_number: createRequest.serial_number || '',
          // RMM fields
          rmm_provider: 'ninjaone',
          rmm_device_id: String(device.id),
          rmm_organization_id: String(device.organizationId),
          agent_status: device.offline ? 'offline' : 'online',
          last_seen_at: device.lastContact,
          last_rmm_sync_at: now,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      // Insert extension data
      const assetType = createRequest.asset_type;
      if (assetType && mappingResult.extensionFields) {
        const extensionTable = `${assetType}_assets`;
        await trx(extensionTable).insert({
          tenant: this.tenantId,
          asset_id: asset.asset_id,
          ...mappingResult.extensionFields,
        });
      }

      // Create external entity mapping
      await trx('tenant_external_entity_mappings').insert({
        id: trx.raw('gen_random_uuid()'),
        tenant: this.tenantId,
        integration_type: 'ninjaone',
        alga_entity_type: 'asset',
        alga_entity_id: asset.asset_id,
        external_entity_id: String(device.id),
        external_realm_id: String(device.organizationId),
        sync_status: 'synced',
        last_synced_at: now,
        metadata: {
          deviceName: device.displayName || device.systemName,
          nodeClass: device.nodeClass,
        },
        created_at: now,
        updated_at: now,
      });

      // Create asset history record
      await trx('asset_history').insert({
        tenant: this.tenantId,
        asset_id: asset.asset_id,
        changed_by: null, // System sync
        change_type: 'created',
        changes: {
          source: 'ninjaone_sync',
          device_id: device.id,
          integration_id: this.integrationId,
        },
        changed_at: now,
      });

      logger.debug('Created asset from NinjaOne device', {
        tenantId: this.tenantId,
        assetId: asset.asset_id,
        deviceId: device.id,
      });

      return asset as Asset;
    });
  }

  /**
   * Update an existing asset from NinjaOne device
   */
  private async updateExistingAsset(
    assetId: string,
    device: NinjaOneDeviceDetail,
    mapping: RmmOrganizationMapping
  ): Promise<Asset> {
    const assetType = determineAssetType(device.nodeClass);
    const baseFields = mapDeviceToAssetBase(device, mapping.client_id!, this.integrationId);

    let extensionFields: Record<string, unknown> | undefined;
    switch (assetType) {
      case 'workstation':
        extensionFields = mapToWorkstationExtension(device) as Record<string, unknown>;
        break;
      case 'server':
        extensionFields = mapToServerExtension(device) as Record<string, unknown>;
        break;
      case 'network_device':
        extensionFields = mapToNetworkDeviceExtension(device) as Record<string, unknown>;
        break;
    }

    return await withTransaction(this.knex!, async (trx: Knex.Transaction) => {
      const now = new Date().toISOString();

      // Update base asset
      const [asset] = await trx('assets')
        .where({ tenant: this.tenantId, asset_id: assetId })
        .update({
          name: baseFields.name,
          serial_number: baseFields.serial_number || '',
          location: baseFields.location || '',
          status: baseFields.status,
          agent_status: baseFields.agent_status,
          last_seen_at: baseFields.last_seen_at,
          last_rmm_sync_at: now,
          updated_at: now,
        })
        .returning('*');

      // Update extension data if applicable
      if (extensionFields && assetType !== 'unknown') {
        const extensionTable = `${assetType}_assets`;

        // Check if extension record exists
        const existingExtension = await trx(extensionTable)
          .where({ tenant: this.tenantId, asset_id: assetId })
          .first();

        if (existingExtension) {
          await trx(extensionTable)
            .where({ tenant: this.tenantId, asset_id: assetId })
            .update(extensionFields);
        } else {
          await trx(extensionTable).insert({
            tenant: this.tenantId,
            asset_id: assetId,
            ...extensionFields,
          });
        }
      }

      // Update external entity mapping
      await trx('tenant_external_entity_mappings')
        .where({
          tenant: this.tenantId,
          integration_type: 'ninjaone',
          alga_entity_type: 'asset',
          external_entity_id: String(device.id),
        })
        .update({
          sync_status: 'synced',
          last_synced_at: now,
          metadata: {
            deviceName: device.displayName || device.systemName,
            nodeClass: device.nodeClass,
          },
          updated_at: now,
        });

      // Create asset history record
      await trx('asset_history').insert({
        tenant: this.tenantId,
        asset_id: assetId,
        changed_by: null,
        change_type: 'updated',
        changes: {
          source: 'ninjaone_sync',
          device_id: device.id,
          integration_id: this.integrationId,
        },
        changed_at: now,
      });

      // Emit device updated event
      await this.emitDeviceUpdatedEvent(asset as Asset, device);

      logger.debug('Updated asset from NinjaOne device', {
        tenantId: this.tenantId,
        assetId,
        deviceId: device.id,
      });

      return asset as Asset;
    });
  }

  /**
   * Update only the last_seen_at timestamp
   */
  private async updateAssetLastSeen(
    assetId: string,
    device: NinjaOneDeviceDetail
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.knex!('assets')
      .where({ tenant: this.tenantId, asset_id: assetId })
      .update({
        agent_status: device.offline ? 'offline' : 'online',
        last_seen_at: device.lastContact,
        last_rmm_sync_at: now,
        updated_at: now,
      });
  }

  /**
   * Handle deleted devices (mark as inactive)
   */
  private async handleDeletedDevices(
    mappings: RmmOrganizationMapping[]
  ): Promise<number> {
    let deletedCount = 0;

    for (const mapping of mappings) {
      // Get all NinjaOne device IDs for this org
      const devices = await this.client!.getDevices({
        organizationId: parseInt(mapping.external_org_id, 10),
      });
      const ninjaDeviceIds = new Set(devices.map(d => String(d.id)));

      // Find Alga assets that no longer exist in NinjaOne
      const existingMappings = await this.knex!('tenant_external_entity_mappings')
        .where({
          tenant: this.tenantId,
          integration_type: 'ninjaone',
          alga_entity_type: 'asset',
          external_realm_id: mapping.external_org_id,
        })
        .select('alga_entity_id', 'external_entity_id');

      for (const existingMapping of existingMappings) {
        if (!ninjaDeviceIds.has(existingMapping.external_entity_id)) {
          // Device no longer exists in NinjaOne
          await this.markAssetAsDeleted(existingMapping.alga_entity_id);
          deletedCount++;

          // Emit device deleted event
          await this.emitDeviceDeletedEvent(existingMapping.alga_entity_id, existingMapping.external_entity_id);
        }
      }
    }

    return deletedCount;
  }

  /**
   * Mark an asset as deleted/inactive
   */
  private async markAssetAsDeleted(assetId: string): Promise<void> {
    const now = new Date().toISOString();

    await withTransaction(this.knex!, async (trx: Knex.Transaction) => {
      // Update asset status to inactive
      await trx('assets')
        .where({ tenant: this.tenantId, asset_id: assetId })
        .update({
          status: 'inactive',
          agent_status: 'offline',
          updated_at: now,
        });

      // Update mapping status
      await trx('tenant_external_entity_mappings')
        .where({
          tenant: this.tenantId,
          integration_type: 'ninjaone',
          alga_entity_id: assetId,
        })
        .update({
          sync_status: 'error',
          metadata: { deleted: true, deletedAt: now },
          updated_at: now,
        });

      // Create history record
      await trx('asset_history').insert({
        tenant: this.tenantId,
        asset_id: assetId,
        changed_by: null,
        change_type: 'updated',
        changes: {
          source: 'ninjaone_sync',
          reason: 'device_deleted_in_rmm',
          integration_id: this.integrationId,
        },
        changed_at: now,
      });
    });

    logger.info('Marked asset as deleted (device removed from NinjaOne)', {
      tenantId: this.tenantId,
      assetId,
    });
  }

  /**
   * Find asset by NinjaOne device ID
   */
  private async findAssetByDeviceId(deviceId: number): Promise<{
    alga_entity_id: string;
    external_entity_id: string;
  } | null> {
    const mapping = await this.knex!('tenant_external_entity_mappings')
      .where({
        tenant: this.tenantId,
        integration_type: 'ninjaone',
        alga_entity_type: 'asset',
        external_entity_id: String(deviceId),
      })
      .first();

    return mapping || null;
  }

  /**
   * Get asset by ID
   */
  private async getAssetById(assetId: string): Promise<Asset | null> {
    const asset = await this.knex!('assets')
      .where({ tenant: this.tenantId, asset_id: assetId })
      .first();
    return asset || null;
  }

  /**
   * Get organization mappings
   */
  private async getOrganizationMappings(
    organizationIds?: number[]
  ): Promise<RmmOrganizationMapping[]> {
    const query = this.knex!('rmm_organization_mappings')
      .where({
        tenant: this.tenantId,
        integration_id: this.integrationId,
        auto_sync_devices: true,
      })
      .whereNotNull('client_id');

    if (organizationIds && organizationIds.length > 0) {
      query.whereIn('external_org_id', organizationIds.map(String));
    }

    return await query;
  }

  /**
   * Update organization mapping last synced timestamp
   */
  private async updateOrganizationMappingLastSynced(mappingId: string): Promise<void> {
    await this.knex!('rmm_organization_mappings')
      .where({ tenant: this.tenantId, mapping_id: mappingId })
      .update({ last_synced_at: new Date().toISOString() });
  }

  /**
   * Update sync status in integration record
   */
  private async updateSyncStatus(status: RmmSyncStatus, errorMessage?: string): Promise<void> {
    const updateData: Partial<RmmIntegration> = {
      sync_status: status,
      updated_at: new Date().toISOString(),
    };

    if (errorMessage) {
      updateData.sync_error = errorMessage;
    } else if (status === 'synced' || status === 'syncing') {
      updateData.sync_error = undefined;
    }

    await this.knex!('rmm_integrations')
      .where({ tenant: this.tenantId, integration_id: this.integrationId })
      .update(updateData);
  }

  /**
   * Update integration after sync completes
   */
  private async updateIntegrationAfterSync(
    result: RmmSyncResult,
    isIncremental = false
  ): Promise<void> {
    const now = new Date().toISOString();
    const updateData: Partial<RmmIntegration> = {
      sync_status: result.success ? 'synced' : 'error',
      updated_at: now,
    };

    if (isIncremental) {
      updateData.last_incremental_sync_at = now;
    } else {
      updateData.last_full_sync_at = now;
    }

    if (result.errors && result.errors.length > 0) {
      updateData.sync_error = result.errors.slice(0, 5).join('; ');
    } else {
      updateData.sync_error = undefined;
    }

    await this.knex!('rmm_integrations')
      .where({ tenant: this.tenantId, integration_id: this.integrationId })
      .update(updateData);
  }

  // Event emission methods
  private async emitSyncStartedEvent(syncType: 'full' | 'incremental'): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_SYNC_STARTED',
        payload: {
          tenant: this.tenantId,
          integration_id: this.integrationId,
          provider: 'ninjaone',
          sync_type: syncType,
          started_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit sync started event', { error });
    }
  }

  private async emitSyncCompletedEvent(result: RmmSyncResult): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_SYNC_COMPLETED',
        payload: {
          tenant: this.tenantId,
          integration_id: this.integrationId,
          provider: 'ninjaone',
          sync_type: result.sync_type,
          items_processed: result.items_processed,
          items_created: result.items_created,
          items_updated: result.items_updated,
          items_deleted: result.items_deleted,
          items_failed: result.items_failed,
          completed_at: result.completed_at,
        },
      });
    } catch (error) {
      logger.warn('Failed to emit sync completed event', { error });
    }
  }

  private async emitSyncFailedEvent(errorMessage: string): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_SYNC_FAILED',
        payload: {
          tenant: this.tenantId,
          integration_id: this.integrationId,
          provider: 'ninjaone',
          error: errorMessage,
          failed_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit sync failed event', { error });
    }
  }

  private async emitDeviceCreatedEvent(asset: Asset, device: NinjaOneDeviceDetail): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_DEVICE_CREATED',
        payload: {
          tenant: this.tenantId,
          asset_id: asset.asset_id,
          device_id: String(device.id),
          device_name: device.displayName || device.systemName,
          provider: 'ninjaone',
          created_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device created event', { error });
    }
  }

  private async emitDeviceUpdatedEvent(asset: Asset, device: NinjaOneDeviceDetail): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_DEVICE_UPDATED',
        payload: {
          tenant: this.tenantId,
          asset_id: asset.asset_id,
          device_id: String(device.id),
          device_name: device.displayName || device.systemName,
          provider: 'ninjaone',
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device updated event', { error });
    }
  }

  private async emitDeviceDeletedEvent(assetId: string, deviceId: string): Promise<void> {
    try {
      await publishEvent({
        event_type: 'RMM_DEVICE_DELETED',
        payload: {
          tenant: this.tenantId,
          asset_id: assetId,
          device_id: deviceId,
          provider: 'ninjaone',
          deleted_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device deleted event', { error });
    }
  }
}

/**
 * Factory function to create a sync engine instance
 */
export async function createSyncEngine(
  tenantId: string,
  integrationId: string
): Promise<NinjaOneSyncEngine> {
  return new NinjaOneSyncEngine(tenantId, integrationId);
}

/**
 * Run a full sync for a tenant/integration
 */
export async function runFullSync(
  tenantId: string,
  integrationId: string,
  options?: SyncOptions
): Promise<RmmSyncResult> {
  const engine = new NinjaOneSyncEngine(tenantId, integrationId);
  return engine.runFullSync(options);
}

/**
 * Run an incremental sync for a tenant/integration
 */
export async function runIncrementalSync(
  tenantId: string,
  integrationId: string,
  since: Date,
  options?: SyncOptions
): Promise<RmmSyncResult> {
  const engine = new NinjaOneSyncEngine(tenantId, integrationId);
  return engine.runIncrementalSync(since, options);
}

/**
 * Sync a single device
 */
export async function syncSingleDevice(
  tenantId: string,
  integrationId: string,
  deviceId: number
): Promise<Asset> {
  const engine = new NinjaOneSyncEngine(tenantId, integrationId);
  return engine.syncDevice(deviceId);
}
