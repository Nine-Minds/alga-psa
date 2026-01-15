import axios from 'axios';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { heartbeat } from '@temporalio/activity';

import logger from '@alga-psa/shared/core/logger';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import { withTransaction } from '@alga-psa/shared/db';
import { getRedisStreamClient } from '@shared/workflow/streams';

import { createNinjaOneClient, NinjaOneClient } from '@ee/lib/integrations/ninjaone/ninjaOneClient';
import {
  mapDevice,
  mapDeviceToAssetBase,
  mapToWorkstationExtension,
  mapToServerExtension,
  mapToNetworkDeviceExtension,
  determineAssetType,
  calculateAssetChanges,
  unixTimestampToIso,
} from '@ee/lib/integrations/ninjaone/mappers/deviceMapper';
import type {
  NinjaOneDevice,
  NinjaOneDeviceDetail,
  NinjaOneOrganization,
} from '@ee/interfaces/ninjaone.interfaces';
import type {
  RmmIntegration,
  RmmOrganizationMapping,
  RmmSyncResult,
  RmmSyncStatus,
} from '@ee/interfaces/rmm.interfaces';
import type { Asset } from '@/interfaces/asset.interfaces';

export interface SyncOptions {
  organizationIds?: number[];
  forceRefresh?: boolean;
  batchSize?: number;
  performedBy?: string;
}

/**
 * Extract safe error info for logging (avoids circular reference issues with axios errors)
 */
function extractErrorInfo(error: unknown): object {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      data: error.response?.data,
    };
  }
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }
  return { message: String(error) };
}

class NinjaOneSyncWorker {
  private tenantId: string;
  private integrationId: string;
  private client: NinjaOneClient | null = null;
  private knex: Knex | null = null;
  private auditUserId: string | null = null;

  constructor(tenantId: string, integrationId: string) {
    this.tenantId = tenantId;
    this.integrationId = integrationId;
  }

  private async initialize(): Promise<void> {
    if (!this.client) {
      this.client = await createNinjaOneClient(this.tenantId);
    }
    if (!this.knex) {
      this.knex = await getAdminConnection();
    }
    if (!this.auditUserId) {
      this.auditUserId = await this.getDefaultAuditUserId();
    }
  }

  private async getDefaultAuditUserId(): Promise<string | null> {
    if (!this.knex) return null;

    const user = await this.knex('users')
      .where({ tenant: this.tenantId })
      .select('user_id')
      .first();

    if (user) {
      return user.user_id;
    }

    logger.warn('No user found in tenant for audit trail', { tenantId: this.tenantId });
    return null;
  }

  public async runFullSync(options: SyncOptions = {}): Promise<RmmSyncResult> {
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

      await this.emitSyncStartedEvent('full');
      await this.updateSyncStatus('syncing');

      const mappings = await this.getOrganizationMappings(options.organizationIds);
      if (mappings.length === 0) {
        logger.warn('No organization mappings found for sync', {
          tenantId: this.tenantId,
          integrationId: this.integrationId,
        });
        result.errors?.push('No organization mappings configured');
        return result;
      }

      logger.info('Starting full NinjaOne sync (Temporal worker)', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        organizationCount: mappings.length,
      });

      const batchSize = options.batchSize || 50;
      let totalDevices = 0;
      let processedDevices = 0;
      let organizationsProcessed = 0;

      for (const mapping of mappings) {
        try {
          const devices = await this.client!.getDevicesByOrganization(
            parseInt(mapping.external_organization_id, 10)
          );

          totalDevices += devices.length;

          logger.info(`[NinjaOne Sync] Processing organization ${organizationsProcessed + 1}/${mappings.length}`, {
            tenantId: this.tenantId,
            organizationName: mapping.external_organization_name,
            organizationId: mapping.external_organization_id,
            deviceCount: devices.length,
            totalDevicesSoFar: totalDevices,
          });

          for (let j = 0; j < devices.length; j += batchSize) {
            const batch = devices.slice(j, j + batchSize);
            const batchResults = await this.processBatch(batch, mapping);

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
            }

            // Heartbeat after each batch to keep the activity alive
            heartbeat({
              organization: mapping.external_organization_name,
              organizationsProcessed: organizationsProcessed + 1,
              totalOrganizations: mappings.length,
              devicesProcessed: processedDevices,
              totalDevices,
              created: result.items_created,
              updated: result.items_updated,
              failed: result.items_failed,
            });

            logger.info(`[NinjaOne Sync] Batch progress`, {
              tenantId: this.tenantId,
              organization: mapping.external_organization_name,
              batchEnd: Math.min(j + batchSize, devices.length),
              orgDevices: devices.length,
              totalProcessed: processedDevices,
              created: result.items_created,
              updated: result.items_updated,
              failed: result.items_failed,
            });
          }

          organizationsProcessed++;
          await this.updateOrganizationMappingLastSynced(mapping.mapping_id);

          logger.info(`[NinjaOne Sync] Completed organization ${organizationsProcessed}/${mappings.length}`, {
            tenantId: this.tenantId,
            organizationName: mapping.external_organization_name,
            devicesProcessed: processedDevices,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logger.error('Failed to sync organization (Temporal worker)', {
            tenantId: this.tenantId,
            integrationId: this.integrationId,
            organizationId: mapping.external_organization_id,
            error: message,
          });
          result.errors?.push(`Organization ${mapping.external_organization_name}: ${message}`);
        }
      }

      const deletedCount = await this.handleDeletedDevices(mappings);
      result.items_deleted = deletedCount;

      result.completed_at = new Date().toISOString();
      result.success = result.items_failed === 0 && !result.errors?.length;

      await this.updateIntegrationAfterSync(result);
      await this.emitSyncCompletedEvent(result);

      logger.info('Full NinjaOne sync completed (Temporal worker)', {
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

      logger.error('Full NinjaOne sync failed (Temporal worker)', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        error: message,
      });

      return result;
    }
  }

  public async runIncrementalSync(
    since: Date,
    options: SyncOptions = {}
  ): Promise<RmmSyncResult> {
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

      logger.info('Starting incremental NinjaOne sync (Temporal worker)', {
        tenantId: this.tenantId,
        integrationId: this.integrationId,
        since: since.toISOString(),
        organizationCount: mappings.length,
      });

      const batchSize = options.batchSize || 50;
      let organizationsProcessed = 0;
      let totalChangedDevices = 0;

      for (const mapping of mappings) {
        try {
          const devices = await this.client!.getDevicesByOrganization(
            parseInt(mapping.external_organization_id, 10)
          );

          const changedDevices = devices.filter((device) => {
            if (!device.lastContact) return true;
            return new Date(device.lastContact) > since;
          });

          totalChangedDevices += changedDevices.length;

          logger.info(`[NinjaOne Sync] Processing organization ${organizationsProcessed + 1}/${mappings.length} (incremental)`, {
            tenantId: this.tenantId,
            organizationName: mapping.external_organization_name,
            totalDevices: devices.length,
            changedDevices: changedDevices.length,
          });

          for (let j = 0; j < changedDevices.length; j += batchSize) {
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

            // Heartbeat after each batch
            heartbeat({
              organization: mapping.external_organization_name,
              organizationsProcessed: organizationsProcessed + 1,
              totalOrganizations: mappings.length,
              devicesProcessed: result.items_processed,
              totalChangedDevices,
              created: result.items_created,
              updated: result.items_updated,
              failed: result.items_failed,
            });

            logger.info(`[NinjaOne Sync] Incremental batch progress`, {
              tenantId: this.tenantId,
              organization: mapping.external_organization_name,
              batchEnd: Math.min(j + batchSize, changedDevices.length),
              changedDevices: changedDevices.length,
              totalProcessed: result.items_processed,
            });
          }

          organizationsProcessed++;
          await this.updateOrganizationMappingLastSynced(mapping.mapping_id);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          result.errors?.push(`Organization ${mapping.external_organization_name}: ${message}`);
        }
      }

      result.completed_at = new Date().toISOString();
      result.success = result.items_failed === 0 && !result.errors?.length;

      await this.updateIntegrationAfterSync(result, true);
      await this.emitSyncCompletedEvent(result);

      logger.info('Incremental NinjaOne sync completed (Temporal worker)', {
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
    }
  }

  public async syncDevice(deviceId: number): Promise<Asset> {
    await this.initialize();

    logger.debug('Syncing single device (Temporal worker)', {
      tenantId: this.tenantId,
      integrationId: this.integrationId,
      deviceId,
    });

    const device = await this.client!.getDevice(deviceId);

    const mapping = await this.knex!('rmm_organization_mappings')
      .where({
        tenant: this.tenantId,
        integration_id: this.integrationId,
        external_organization_id: String(device.organizationId),
      })
      .first<RmmOrganizationMapping>();

    if (!mapping || !mapping.client_id) {
      throw new Error(`No client mapping found for organization ${device.organizationId}`);
    }

    const existingMapping = await this.findAssetByDeviceId(deviceId);

    if (existingMapping) {
      return await this.updateExistingAsset(existingMapping.alga_entity_id, device, mapping);
    }

    return await this.createNewAsset(device, mapping);
  }

  public async syncOrganization(organizationId: number): Promise<RmmSyncResult> {
    return this.runFullSync({ organizationIds: [organizationId] });
  }

  private async processBatch(
    devices: NinjaOneDevice[],
    mapping: RmmOrganizationMapping
  ): Promise<Array<{ deviceId: number; deviceName: string; assetId?: string; action: 'created' | 'updated' | 'skipped' | 'failed'; error?: string; changes?: Record<string, { old: unknown; new: unknown }>; }>> {
    const results: Array<{ deviceId: number; deviceName: string; assetId?: string; action: 'created' | 'updated' | 'skipped' | 'failed'; error?: string; changes?: Record<string, { old: unknown; new: unknown }>; }> = [];

    for (const device of devices) {
      try {
        const deviceDetail = await this.client!.getDevice(device.id);
        
        // Look up the correct mapping based on the device's actual organization ID
        // This ensures devices are assigned to the correct company even if they were
        // returned from a different organization's device list
        const deviceMapping = await this.getOrganizationMappingByExternalId(deviceDetail.organizationId);
        
        if (!deviceMapping || !deviceMapping.client_id) {
          results.push({
            deviceId: device.id,
            deviceName: device.displayName || device.systemName || `Device-${device.id}`,
            action: 'failed',
            error: `No client mapping found for organization ${deviceDetail.organizationId}`,
          });
          continue;
        }

        const existingMapping = await this.findAssetByDeviceId(device.id);

        if (existingMapping) {
          const existingAsset = await this.getAssetById(existingMapping.alga_entity_id);
          if (existingAsset) {
            const changes = calculateAssetChanges(existingAsset, deviceDetail);

            if (Object.keys(changes).length > 0) {
              // Use the device's actual organization mapping, not the one passed to processBatch
              await this.updateExistingAsset(existingMapping.alga_entity_id, deviceDetail, deviceMapping);
              results.push({
                deviceId: device.id,
                deviceName: device.displayName || device.systemName || `Device-${device.id}`,
                assetId: existingMapping.alga_entity_id,
                action: 'updated',
                changes,
              });
            } else {
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
          // Use the device's actual organization mapping for new assets
          const newAsset = await this.createNewAsset(deviceDetail, deviceMapping);
          results.push({
            deviceId: device.id,
            deviceName: device.displayName || device.systemName || `Device-${device.id}`,
            assetId: newAsset.asset_id,
            action: 'created',
          });

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

  private async createNewAsset(
    device: NinjaOneDeviceDetail,
    mapping: RmmOrganizationMapping
  ): Promise<Asset> {
    const mappingResult = mapDevice(device, mapping.client_id!, this.integrationId);

    if (!mappingResult.success || !mappingResult.createRequest) {
      throw new Error(mappingResult.error || 'Failed to map device to asset');
    }

    const createRequest = mappingResult.createRequest;
    const baseAssetData = mappingResult.baseFields!;

    return await withTransaction(this.knex!, async (trx: Knex.Transaction) => {
      const now = new Date().toISOString();

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
          rmm_provider: 'ninjaone',
          rmm_device_id: String(device.id),
          rmm_organization_id: String(device.organizationId),
          agent_status: device.offline ? 'offline' : 'online',
          last_seen_at: unixTimestampToIso(device.lastContact),
          last_rmm_sync_at: now,
          created_at: now,
          updated_at: now,
        })
        .returning('*');

      const assetType = createRequest.asset_type;
      if (assetType && mappingResult.extensionFields) {
        const extensionTable = `${assetType}_assets`;
        await trx(extensionTable).insert({
          tenant: this.tenantId,
          asset_id: asset.asset_id,
          ...mappingResult.extensionFields,
        });
      }

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

      if (this.auditUserId) {
        await trx('asset_history').insert({
          tenant: this.tenantId,
          asset_id: asset.asset_id,
          changed_by: this.auditUserId,
          change_type: 'created',
          changes: {
            source: 'ninjaone_sync',
            device_id: device.id,
            integration_id: this.integrationId,
          },
          changed_at: now,
        });
      }

      logger.debug('Created asset from NinjaOne device (Temporal worker)', {
        tenantId: this.tenantId,
        assetId: asset.asset_id,
        deviceId: device.id,
      });

      return asset as Asset;
    });
  }

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

      // Get current asset to check if client_id needs updating
      const currentAsset = await trx('assets')
        .where({ tenant: this.tenantId, asset_id: assetId })
        .first();

      const updateData: Record<string, unknown> = {
        name: baseFields.name,
        serial_number: baseFields.serial_number || '',
        location: baseFields.location || '',
        status: baseFields.status,
        agent_status: baseFields.agent_status,
        last_seen_at: baseFields.last_seen_at,
        last_rmm_sync_at: now,
        updated_at: now,
      };

      // Update client_id if it has changed (corrects misassigned assets)
      if (baseFields.client_id && currentAsset?.client_id !== baseFields.client_id) {
        updateData.client_id = baseFields.client_id;
        logger.info('Correcting asset client_id assignment (Temporal worker)', {
          tenantId: this.tenantId,
          assetId,
          deviceId: device.id,
          oldClientId: currentAsset?.client_id,
          newClientId: baseFields.client_id,
          deviceOrganizationId: device.organizationId,
        });
      }

      const [asset] = await trx('assets')
        .where({ tenant: this.tenantId, asset_id: assetId })
        .update(updateData)
        .returning('*');

      if (extensionFields && assetType !== 'unknown') {
        const extensionTable = `${assetType}_assets`;
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

      if (this.auditUserId) {
        const historyChanges: Record<string, unknown> = {
          source: 'ninjaone_sync',
          device_id: device.id,
          integration_id: this.integrationId,
        };

        // Include client_id change in audit trail if it was corrected
        if (baseFields.client_id && currentAsset?.client_id !== baseFields.client_id) {
          historyChanges.client_id_corrected = true;
          historyChanges.old_client_id = currentAsset?.client_id;
          historyChanges.new_client_id = baseFields.client_id;
          historyChanges.reason = 'Device organization mapping correction';
        }

        await trx('asset_history').insert({
          tenant: this.tenantId,
          asset_id: assetId,
          changed_by: this.auditUserId,
          change_type: 'updated',
          changes: historyChanges,
          changed_at: now,
        });
      }

      await this.emitDeviceUpdatedEvent(asset as Asset, device);

      logger.debug('Updated asset from NinjaOne device (Temporal worker)', {
        tenantId: this.tenantId,
        assetId,
        deviceId: device.id,
      });

      return asset as Asset;
    });
  }

  private async updateAssetLastSeen(assetId: string, device: NinjaOneDeviceDetail): Promise<void> {
    const now = new Date().toISOString();

    await this.knex!('assets')
      .where({ tenant: this.tenantId, asset_id: assetId })
      .update({
        agent_status: device.offline ? 'offline' : 'online',
        last_seen_at: unixTimestampToIso(device.lastContact),
        last_rmm_sync_at: now,
        updated_at: now,
      });
  }

  private async handleDeletedDevices(mappings: RmmOrganizationMapping[]): Promise<number> {
    let deletedCount = 0;

    for (const mapping of mappings) {
      const devices = await this.client!.getDevicesByOrganization(
        parseInt(mapping.external_organization_id, 10)
      );
      const ninjaDeviceIds = new Set(devices.map((d) => String(d.id)));

      const existingMappings = await this.knex!('tenant_external_entity_mappings')
        .where({
          tenant: this.tenantId,
          integration_type: 'ninjaone',
          alga_entity_type: 'asset',
          external_realm_id: mapping.external_organization_id,
        })
        .select('alga_entity_id', 'external_entity_id');

      for (const existingMapping of existingMappings) {
        if (!ninjaDeviceIds.has(existingMapping.external_entity_id)) {
          await this.markAssetAsDeleted(existingMapping.alga_entity_id);
          deletedCount++;
          await this.emitDeviceDeletedEvent(existingMapping.alga_entity_id, existingMapping.external_entity_id);
        }
      }
    }

    return deletedCount;
  }

  private async markAssetAsDeleted(assetId: string): Promise<void> {
    const now = new Date().toISOString();

    await withTransaction(this.knex!, async (trx: Knex.Transaction) => {
      await trx('assets')
        .where({ tenant: this.tenantId, asset_id: assetId })
        .update({
          status: 'inactive',
          agent_status: 'offline',
          updated_at: now,
        });

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

      if (this.auditUserId) {
        await trx('asset_history').insert({
          tenant: this.tenantId,
          asset_id: assetId,
          changed_by: this.auditUserId,
          change_type: 'updated',
          changes: {
            source: 'ninjaone_sync',
            reason: 'device_deleted_in_rmm',
            integration_id: this.integrationId,
          },
          changed_at: now,
        });
      }
    });

    logger.info('Marked asset as deleted (device removed from NinjaOne) (Temporal worker)', {
      tenantId: this.tenantId,
      assetId,
    });
  }

  private async findAssetByDeviceId(deviceId: number): Promise<{
    alga_entity_id: string;
    external_entity_id: string;
  } | null> {
    const mapping = await this.knex!('tenant_external_entity_mappings')
      .join('assets', (join) => {
        (join as any)
          .on(
            this.knex!.raw(
              'assets.asset_id::text = tenant_external_entity_mappings.alga_entity_id'
            )
          )
          .andOn('tenant_external_entity_mappings.tenant', '=', 'assets.tenant');
      })
      .where({
        'tenant_external_entity_mappings.tenant': this.tenantId,
        'tenant_external_entity_mappings.integration_type': 'ninjaone',
        'tenant_external_entity_mappings.alga_entity_type': 'asset',
        'tenant_external_entity_mappings.external_entity_id': String(deviceId),
        'assets.status': 'active',
      })
      .where('assets.tenant', this.tenantId)
      .select('tenant_external_entity_mappings.alga_entity_id', 'tenant_external_entity_mappings.external_entity_id')
      .first();

    return mapping || null;
  }

  private async getAssetById(assetId: string): Promise<Asset | null> {
    const asset = await this.knex!('assets')
      .where({ tenant: this.tenantId, asset_id: assetId })
      .first();
    return asset || null;
  }

  private async getOrganizationMappings(
    organizationIds?: number[]
  ): Promise<RmmOrganizationMapping[]> {
    const query = this.knex!('rmm_organization_mappings')
      .where({
        tenant: this.tenantId,
        integration_id: this.integrationId,
        auto_sync_assets: true,
      })
      .whereNotNull('client_id');

    if (organizationIds && organizationIds.length > 0) {
      query.whereIn('external_organization_id', organizationIds.map(String));
    }

    return await query;
  }

  private async getOrganizationMappingByExternalId(
    externalOrganizationId: number
  ): Promise<RmmOrganizationMapping | null> {
    const mapping = await this.knex!('rmm_organization_mappings')
      .where({
        tenant: this.tenantId,
        integration_id: this.integrationId,
        external_organization_id: String(externalOrganizationId),
      })
      .whereNotNull('client_id')
      .first<RmmOrganizationMapping>();

    return mapping || null;
  }

  private async updateOrganizationMappingLastSynced(mappingId: string): Promise<void> {
    await this.knex!('rmm_organization_mappings')
      .where({ tenant: this.tenantId, mapping_id: mappingId })
      .update({ last_synced_at: new Date().toISOString() });
  }

  private async updateSyncStatus(status: RmmSyncStatus, errorMessage?: string): Promise<void> {
    const updateData: Partial<RmmIntegration> = {
      sync_status: status,
      updated_at: new Date().toISOString(),
    };

    if (errorMessage) {
      updateData.sync_error = errorMessage;
    } else if (status === 'completed' || status === 'syncing') {
      updateData.sync_error = undefined;
    }

    await this.knex!('rmm_integrations')
      .where({ tenant: this.tenantId, integration_id: this.integrationId })
      .update(updateData);
  }

  private async updateIntegrationAfterSync(
    result: RmmSyncResult,
    isIncremental = false
  ): Promise<void> {
    const now = new Date().toISOString();
    const updateData: Partial<RmmIntegration> = {
      sync_status: result.success ? 'completed' : 'error',
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

  private async emitSyncStartedEvent(syncType: 'full' | 'incremental'): Promise<void> {
    try {
      const eventType = 'RMM_SYNC_STARTED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
          integration_id: this.integrationId,
          provider: 'ninjaone',
          sync_type: syncType,
          started_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit sync started event', { error: extractErrorInfo(error) });
    }
  }

  private async emitSyncCompletedEvent(result: RmmSyncResult): Promise<void> {
    try {
      const eventType = 'RMM_SYNC_COMPLETED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
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
      logger.warn('Failed to emit sync completed event', { error: extractErrorInfo(error) });
    }
  }

  private async emitSyncFailedEvent(errorMessage: string): Promise<void> {
    try {
      const eventType = 'RMM_SYNC_FAILED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
          integration_id: this.integrationId,
          provider: 'ninjaone',
          error: errorMessage,
          failed_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit sync failed event', { error: extractErrorInfo(error) });
    }
  }

  private async emitDeviceCreatedEvent(asset: Asset, device: NinjaOneDeviceDetail): Promise<void> {
    try {
      const eventType = 'RMM_DEVICE_CREATED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
          asset_id: asset.asset_id,
          device_id: String(device.id),
          device_name: device.displayName || device.systemName,
          provider: 'ninjaone',
          created_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device created event', { error: extractErrorInfo(error) });
    }
  }

  private async emitDeviceUpdatedEvent(asset: Asset, device: NinjaOneDeviceDetail): Promise<void> {
    try {
      const eventType = 'RMM_DEVICE_UPDATED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
          asset_id: asset.asset_id,
          device_id: String(device.id),
          device_name: device.displayName || device.systemName,
          provider: 'ninjaone',
          updated_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device updated event', { error: extractErrorInfo(error) });
    }
  }

  private async emitDeviceDeletedEvent(assetId: string, deviceId: string): Promise<void> {
    try {
      const eventType = 'RMM_DEVICE_DELETED';
      await getRedisStreamClient().publishEvent({
        event_id: uuidv4(),
        event_name: eventType,
        event_type: eventType,
        tenant: this.tenantId,
        timestamp: new Date().toISOString(),
        payload: {
          asset_id: assetId,
          device_id: deviceId,
          provider: 'ninjaone',
          deleted_at: new Date().toISOString(),
        },
      });
    } catch (error) {
      logger.warn('Failed to emit device deleted event', { error: extractErrorInfo(error) });
    }
  }
}

export async function syncNinjaOneOrganizationsActivity(input: {
  tenantId: string;
  integrationId: string;
  performedBy?: string;
}): Promise<RmmSyncResult> {
  const startTime = new Date().toISOString();
  let itemsProcessed = 0;
  let itemsCreated = 0;
  let itemsUpdated = 0;
  const errors: string[] = [];

  try {
    const { tenantId, integrationId } = input;
    const knex = await getAdminConnection();

    const integration = await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId })
      .update({
        sync_status: 'syncing',
        updated_at: knex.fn.now(),
      });

    const client = await createNinjaOneClient(tenantId);
    const organizations: NinjaOneOrganization[] = await client.getOrganizations();

    itemsProcessed = organizations.length;

    for (const org of organizations) {
      try {
        const existingMapping = await knex('rmm_organization_mappings')
          .where({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_organization_id: String(org.id),
          })
          .first();

        if (existingMapping) {
          await knex('rmm_organization_mappings')
            .where({ tenant: tenantId, mapping_id: existingMapping.mapping_id })
            .update({
              external_organization_name: org.name,
              metadata: JSON.stringify({ description: org.description, tags: org.tags }),
              updated_at: knex.fn.now(),
            });
          itemsUpdated++;
        } else {
          await knex('rmm_organization_mappings').insert({
            tenant: tenantId,
            integration_id: integration.integration_id,
            external_organization_id: String(org.id),
            external_organization_name: org.name,
            auto_sync_assets: true,
            auto_create_tickets: false,
            metadata: JSON.stringify({ description: org.description, tags: org.tags }),
          });
          itemsCreated++;
        }
      } catch (orgError) {
        const errorMessage = orgError instanceof Error ? orgError.message : String(orgError);
        errors.push(`Failed to process organization ${org.id}: ${errorMessage}`);
        logger.error('[NinjaOneActions] Error processing organization (Temporal worker):', { orgId: org.id, error: orgError });
      }
    }

    await knex('rmm_integrations')
      .where({ tenant: tenantId, integration_id: integrationId })
      .update({
        sync_status: 'completed',
        last_sync_at: knex.fn.now(),
        sync_error: errors.length > 0 ? errors.join('; ') : null,
        updated_at: knex.fn.now(),
      });

    return {
      success: errors.length === 0,
      provider: 'ninjaone',
      sync_type: 'organizations',
      started_at: startTime,
      completed_at: new Date().toISOString(),
      items_processed: itemsProcessed,
      items_created: itemsCreated,
      items_updated: itemsUpdated,
      items_failed: errors.length,
      errors: errors.length > 0 ? errors : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error syncing organizations (Temporal worker):', extractErrorInfo(error));

    try {
      const knex = await getAdminConnection();
      await knex('rmm_integrations')
        .where({ tenant: input.tenantId, integration_id: input.integrationId })
        .update({
          sync_status: 'error',
          sync_error: errorMessage,
          updated_at: knex.fn.now(),
        });
    } catch {
      // Ignore update errors
    }

    return {
      success: false,
      provider: 'ninjaone',
      sync_type: 'organizations',
      started_at: startTime,
      completed_at: new Date().toISOString(),
      items_processed: itemsProcessed,
      items_created: itemsCreated,
      items_updated: itemsUpdated,
      items_failed: 1,
      errors: [errorMessage],
    };
  }
}

export async function syncNinjaOneDevicesFullActivity(input: {
  tenantId: string;
  integrationId: string;
  options?: SyncOptions;
}): Promise<RmmSyncResult> {
  const engine = new NinjaOneSyncWorker(input.tenantId, input.integrationId);
  return engine.runFullSync(input.options);
}

export async function syncNinjaOneDevicesIncrementalActivity(input: {
  tenantId: string;
  integrationId: string;
  since: string;
  options?: SyncOptions;
}): Promise<RmmSyncResult> {
  const engine = new NinjaOneSyncWorker(input.tenantId, input.integrationId);
  return engine.runIncrementalSync(new Date(input.since), input.options);
}

export async function syncNinjaOneDeviceActivity(input: {
  tenantId: string;
  integrationId: string;
  deviceId: number;
}): Promise<Asset> {
  const engine = new NinjaOneSyncWorker(input.tenantId, input.integrationId);
  return engine.syncDevice(input.deviceId);
}
