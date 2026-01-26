import logger from '@alga-psa/core/logger';
import { createTenantKnex } from '@/lib/db';
import { createNinjaOneClient } from '../ninjaOneClient';
import {
  runFullSync as runFullSyncEngine,
  runIncrementalSync as runIncrementalSyncEngine,
  syncSingleDevice,
  SyncOptions,
} from './syncEngine';
import type { Asset } from '@/interfaces/asset.interfaces';
import type { RmmIntegration, RmmSyncResult } from '../../../../interfaces/rmm.interfaces';

export interface NinjaOneSyncStrategy {
  syncOrganizations(input: {
    tenantId: string;
    integrationId: string;
    performedBy?: string;
  }): Promise<RmmSyncResult>;
  syncDevicesFull(input: {
    tenantId: string;
    integrationId: string;
    options?: SyncOptions;
  }): Promise<RmmSyncResult>;
  syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
    options?: SyncOptions;
  }): Promise<RmmSyncResult>;
  syncDevice(input: {
    tenantId: string;
    integrationId: string;
    deviceId: number;
  }): Promise<Asset>;
}

class DirectNinjaOneSyncStrategy implements NinjaOneSyncStrategy {
  async syncOrganizations(input: {
    tenantId: string;
    integrationId: string;
  }): Promise<RmmSyncResult> {
    const startTime = new Date().toISOString();
    let itemsProcessed = 0;
    let itemsCreated = 0;
    let itemsUpdated = 0;
    const errors: string[] = [];

    try {
      const { knex } = await createTenantKnex();
      const { tenantId, integrationId } = input;

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

      const client = await createNinjaOneClient(tenantId, undefined, { integrationId });
      const organizations = await client.getOrganizations();

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
          logger.error('[NinjaOneSync] Error processing organization:', { orgId: org.id, error: orgError });
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
      logger.error('[NinjaOneSync] Error syncing organizations:', errorMessage);

      try {
        const { knex } = await createTenantKnex();
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

  async syncDevicesFull(input: {
    tenantId: string;
    integrationId: string;
    options?: SyncOptions;
  }): Promise<RmmSyncResult> {
    return runFullSyncEngine(input.tenantId, input.integrationId, input.options);
  }

  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
    options?: SyncOptions;
  }): Promise<RmmSyncResult> {
    return runIncrementalSyncEngine(
      input.tenantId,
      input.integrationId,
      input.since,
      input.options
    );
  }

  async syncDevice(input: {
    tenantId: string;
    integrationId: string;
    deviceId: number;
  }): Promise<Asset> {
    return syncSingleDevice(input.tenantId, input.integrationId, input.deviceId);
  }
}

class TemporalNinjaOneSyncStrategy implements NinjaOneSyncStrategy {
  private async getTemporalClient() {
    const temporal = await import('@temporalio/client');
    const address = process.env.TEMPORAL_ADDRESS || 'temporal-frontend.temporal.svc.cluster.local:7233';
    const namespace = process.env.TEMPORAL_NAMESPACE || 'default';

    const connection = await temporal.Connection.connect({ address });
    return new temporal.Client({ connection, namespace });
  }

  private getTaskQueue(): string {
    return process.env.TEMPORAL_JOB_TASK_QUEUE || 'alga-jobs';
  }

  async syncOrganizations(input: {
    tenantId: string;
    integrationId: string;
    performedBy?: string;
  }): Promise<RmmSyncResult> {
    const client = await this.getTemporalClient();
    const workflowId = `ninjaone:orgs:${input.tenantId}:${input.integrationId}:${Date.now()}`;

    const handle = await client.workflow.start('ninjaOneSyncWorkflow', {
      taskQueue: this.getTaskQueue(),
      workflowId,
      args: [{
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        syncType: 'organizations',
        options: { performedBy: input.performedBy },
      }],
    });

    return await handle.result();
  }

  async syncDevicesFull(input: {
    tenantId: string;
    integrationId: string;
    options?: SyncOptions;
  }): Promise<RmmSyncResult> {
    const client = await this.getTemporalClient();
    const workflowId = `ninjaone:full:${input.tenantId}:${input.integrationId}:${Date.now()}`;

    const handle = await client.workflow.start('ninjaOneSyncWorkflow', {
      taskQueue: this.getTaskQueue(),
      workflowId,
      args: [{
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        syncType: 'full',
        options: input.options,
      }],
    });

    return await handle.result();
  }

  async syncDevicesIncremental(input: {
    tenantId: string;
    integrationId: string;
    since: Date;
    options?: SyncOptions;
  }): Promise<RmmSyncResult> {
    const client = await this.getTemporalClient();
    const workflowId = `ninjaone:incremental:${input.tenantId}:${input.integrationId}:${Date.now()}`;

    const handle = await client.workflow.start('ninjaOneSyncWorkflow', {
      taskQueue: this.getTaskQueue(),
      workflowId,
      args: [{
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        syncType: 'incremental',
        since: input.since.toISOString(),
        options: input.options,
      }],
    });

    return await handle.result();
  }

  async syncDevice(input: {
    tenantId: string;
    integrationId: string;
    deviceId: number;
  }): Promise<Asset> {
    const client = await this.getTemporalClient();
    const workflowId = `ninjaone:device:${input.tenantId}:${input.deviceId}:${Date.now()}`;

    const handle = await client.workflow.start('ninjaOneDeviceSyncWorkflow', {
      taskQueue: this.getTaskQueue(),
      workflowId,
      args: [{
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        deviceId: input.deviceId,
      }],
    });

    return await handle.result();
  }
}

let cachedStrategy: NinjaOneSyncStrategy | null = null;

export function getNinjaOneSyncStrategy(): NinjaOneSyncStrategy {
  if (cachedStrategy) {
    return cachedStrategy;
  }

  const edition = process.env.NEXT_PUBLIC_EDITION;
  const configuredStrategy = process.env.NINJAONE_SYNC_STRATEGY;
  const useTemporal = configuredStrategy
    ? configuredStrategy === 'temporal'
    : edition === 'enterprise';

  cachedStrategy = useTemporal
    ? new TemporalNinjaOneSyncStrategy()
    : new DirectNinjaOneSyncStrategy();

  return cachedStrategy;
}
