/**
 * NinjaOne Webhook Handler
 *
 * Processes webhook events from NinjaOne RMM platform.
 * Handles device lifecycle events, alerts, and status changes.
 */

import { Knex } from 'knex';
import crypto from 'crypto';
import { createTenantKnex } from '@/lib/db';
import { tenantDb, withTransaction } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { publishEvent } from '@shared/events/publisher';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import {
  buildIntegrationWebhookReceivedPayload,
  sanitizeIntegrationWebhookRawPayload,
} from '@alga-psa/workflow-streams';
import { NinjaOneSyncEngine } from '../sync/syncEngine';
import { processRmmAlertEvent } from '@alga-psa/shared/rmm/alerts';
import { buildRmmAlertPipelineDeps } from '@alga-psa/integrations/lib/rmm/alerts/pipelineDeps';
import { mapNinjaOneWebhookToAlertEvent } from '../alerts/normalizer';
import {
  NinjaOneWebhookPayload,
  NinjaOneActivityType,
} from '../../../../interfaces/ninjaone.interfaces';
import {
  RmmIntegration,
  RmmIntegrationSettings,
  RmmOrganizationMapping,
} from '../../../../interfaces/rmm.interfaces';

/**
 * Webhook processing result
 */
export interface WebhookProcessingResult {
  success: boolean;
  processed: boolean;
  action?: string;
  entityId?: string;
  error?: string;
}

/**
 * Activity types that trigger device sync
 */
const DEVICE_LIFECYCLE_ACTIVITIES: NinjaOneActivityType[] = [
  'NODE_CREATED',
  'NODE_UPDATED',
  'NODE_DELETED',
  'NODE_APPROVED',
  'NODE_APPROVAL_REJECTED',
  'NODE_MANUALLY_APPROVED',
];

/**
 * Activity types related to device status
 */
const DEVICE_STATUS_ACTIVITIES: NinjaOneActivityType[] = [
  'SYSTEM_REBOOTED',
  'USER_LOGGED_IN',
  'USER_LOGGED_OUT',
  'AGENT_INSTALLED',
  'AGENT_UNINSTALLED',
];

/**
 * Activity types that trigger hardware updates
 */
const HARDWARE_CHANGE_ACTIVITIES: NinjaOneActivityType[] = [
  'CPU_ADDED',
  'CPU_REMOVED',
  'MEMORY_ADDED',
  'MEMORY_REMOVED',
  'DISK_DRIVE_ADDED',
  'DISK_DRIVE_REMOVED',
  'NETWORK_INTERFACE_ADDED',
  'NETWORK_INTERFACE_REMOVED',
];

/**
 * Verify webhook signature
 *
 * NinjaOne sends HMAC-SHA256 signature in the X-Ninja-Signature header
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) {
    return false;
  }

  try {
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Use timing-safe comparison
    return crypto.timingSafeEqual(
      Buffer.from(signature.toLowerCase()),
      Buffer.from(expectedSignature.toLowerCase())
    );
  } catch (error) {
    logger.error('Error verifying webhook signature', { error });
    return false;
  }
}

/**
 * Find integration by webhook secret or organization ID
 */
export async function findIntegrationForWebhook(
  organizationId: number
): Promise<{
  integration: RmmIntegration;
  tenantId: string;
  mapping: RmmOrganizationMapping;
} | null> {
  const { knex } = await createTenantKnex();
  const discoveryDb = tenantDb(knex, 'pre-tenant-discovery');

  // Find the organization mapping to get tenant and integration
  const result = await discoveryDb
    .unscoped(
      'rmm_organization_mappings as rom',
      'NinjaOne webhook organization lookup derives tenant before tenant facade can be constructed'
    )
    .join('rmm_integrations as ri', function() {
      this.on('rom.integration_id', '=', 'ri.integration_id')
        .andOn('rom.tenant', '=', 'ri.tenant');
    })
    .where('rom.external_organization_id', String(organizationId))
    .where('ri.provider', 'ninjaone')
    .where('ri.is_active', true)
    .first<{
      tenant: string;
      integration_id: string;
      provider: string;
      is_active: boolean;
      instance_url: string | null;
      settings: string | null;
      mapping_id: string;
      external_organization_id: string;
      external_organization_name: string | null;
      client_id: string | null;
      auto_sync_assets: boolean;
    }>(
      'rom.tenant',
      'ri.integration_id',
      'ri.provider',
      'ri.is_active',
      'ri.instance_url',
      'ri.settings',
      'rom.mapping_id',
      'rom.external_organization_id',
      'rom.external_organization_name',
      'rom.client_id',
      'rom.auto_sync_assets'
    );

  if (!result) {
    return null;
  }

  // Parse settings to extract webhook secret
  let parsedSettings: Record<string, unknown> = {};
  if (result.settings) {
    try {
      parsedSettings = JSON.parse(result.settings);
    } catch {
      parsedSettings = {};
    }
  }

  // Get webhook secret from settings
  const webhookSecret = (parsedSettings.webhookSecret as string) || undefined;

  // Merge webhook secret into settings for consistent access
  const settings = {
    ...parsedSettings,
    webhook_secret: webhookSecret,
  } as RmmIntegrationSettings;

  return {
    tenantId: result.tenant,
    integration: {
      tenant: result.tenant,
      integration_id: result.integration_id,
      provider: 'ninjaone',
      is_active: result.is_active,
      instance_url: result.instance_url || undefined,
      settings,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as RmmIntegration,
    mapping: {
      tenant: result.tenant,
      mapping_id: result.mapping_id,
      integration_id: result.integration_id,
      external_organization_id: result.external_organization_id,
      external_organization_name: result.external_organization_name || undefined,
      client_id: result.client_id || undefined,
      auto_sync_assets: result.auto_sync_assets,
    } as RmmOrganizationMapping,
  };
}

/**
 * Main webhook handler
 */
export async function handleNinjaOneWebhook(
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  logger.debug('Processing NinjaOne webhook', {
    activityType: payload.activityType,
    deviceId: payload.deviceId,
    organizationId: payload.organizationId,
  });

  // Find the integration and tenant for this webhook
  const context = await findIntegrationForWebhook(payload.organizationId);

  if (!context) {
    logger.warn('No integration found for webhook', {
      organizationId: payload.organizationId,
    });
    return {
      success: false,
      processed: false,
      error: 'No integration found for organization',
    };
  }

  const { tenantId, integration, mapping } = context;

  // Emit webhook received event
  try {
    await publishEvent({
      eventType: 'RMM_WEBHOOK_RECEIVED',
      tenant: tenantId,
      payload: {
        integration_id: integration.integration_id,
        provider: 'ninjaone',
        activity_type: payload.activityType,
        device_id: payload.deviceId?.toString(),
        received_at: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.warn('Failed to emit webhook received event', { error });
  }

  // Emit workflow v2 integration webhook received event (safe payload reference)
  try {
    const payloadRef = `integration-webhook:${crypto.randomUUID()}`;
    const snapshot = sanitizeIntegrationWebhookRawPayload(payload, { maxBytes: 10_000 });
    logger.debug('[NinjaOne Webhook] Payload snapshot (redacted)', {
      tenantId,
      integrationId: integration.integration_id,
      provider: 'ninjaone',
      payloadRef,
      truncated: snapshot.truncated,
      snapshot: snapshot.snapshot,
    });

    const webhookId =
      (payload.id != null ? String(payload.id) : null) ??
      (payload.activityId != null ? String(payload.activityId) : null) ??
      (() => {
        try {
          const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(payload))
            .digest('hex')
            .slice(0, 24);
          return `sha256:${hash}`;
        } catch {
          return crypto.randomUUID();
        }
      })();

    let receivedAt = new Date().toISOString();
    if (payload.activityTime) {
      try {
        const parsed = new Date(payload.activityTime);
        if (!Number.isNaN(parsed.getTime())) {
          receivedAt = parsed.toISOString();
        }
      } catch {
        // ignore invalid activityTime
      }
    }

    await publishWorkflowEvent({
      eventType: 'INTEGRATION_WEBHOOK_RECEIVED',
      payload: buildIntegrationWebhookReceivedPayload({
        integrationId: integration.integration_id,
        provider: 'ninjaone',
        webhookId,
        eventName: payload.activityType,
        receivedAt,
        rawPayloadRef: payloadRef,
      }),
      ctx: {
        tenantId,
        actor: { actorType: 'SYSTEM' },
        correlationId: payloadRef,
        occurredAt: receivedAt,
      },
      idempotencyKey: `integration_webhook_received:${tenantId}:${integration.integration_id}:${webhookId}:${payload.activityType}`,
      eventName: payload.activityType,
    });
  } catch (error) {
    logger.warn('[NinjaOne Webhook] Failed to publish workflow INTEGRATION_WEBHOOK_RECEIVED event', {
      error,
    });
  }

  // Route to appropriate handler
  const activityType = payload.activityType as NinjaOneActivityType;

  // Alert conditions (TRIGGERED / RESET / ACKNOWLEDGED) run through the
  // provider-agnostic pipeline in @alga-psa/shared/rmm/alerts.
  if (payload.type === 'CONDITION') {
    return handleAlertConditionEvent(tenantId, integration, mapping, payload);
  }

  // Device lifecycle events
  if (DEVICE_LIFECYCLE_ACTIVITIES.includes(activityType)) {
    return handleDeviceLifecycleEvent(tenantId, integration, mapping, payload);
  }

  // Device status events
  if (DEVICE_STATUS_ACTIVITIES.includes(activityType)) {
    return handleDeviceStatusEvent(tenantId, integration, mapping, payload);
  }

  // Hardware change events
  if (HARDWARE_CHANGE_ACTIVITIES.includes(activityType)) {
    return handleHardwareChangeEvent(tenantId, integration, mapping, payload);
  }

  // Unknown or unhandled event type
  logger.debug('Unhandled webhook activity type', {
    activityType: payload.activityType,
    type: payload.type,
    status: payload.status,
  });

  return {
    success: true,
    processed: false,
    action: 'ignored',
  };
}

/**
 * Handle device lifecycle events (created, updated, deleted)
 */
async function handleDeviceLifecycleEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  const activityType = payload.activityType as NinjaOneActivityType;

  // Skip if auto-sync is disabled
  if (!mapping.auto_sync_assets) {
    return {
      success: true,
      processed: false,
      action: 'skipped_auto_sync_disabled',
    };
  }

  // Skip if no client mapping
  if (!mapping.client_id) {
    return {
      success: true,
      processed: false,
      action: 'skipped_no_client_mapping',
    };
  }

  try {
    const syncEngine = new NinjaOneSyncEngine(tenantId, integration.integration_id);

    switch (activityType) {
      case 'NODE_CREATED':
      case 'NODE_APPROVED':
      case 'NODE_MANUALLY_APPROVED':
        if (payload.deviceId) {
          const asset = await syncEngine.syncDevice(payload.deviceId);
          await publishEvent({
            eventType: 'RMM_DEVICE_CREATED',
            tenant: tenantId,
            payload: {
              asset_id: asset.asset_id,
              device_id: String(payload.deviceId),
              device_name: payload.device?.displayName || payload.device?.systemName,
              provider: 'ninjaone',
              created_at: new Date().toISOString(),
            },
          });
          return {
            success: true,
            processed: true,
            action: 'device_created',
            entityId: asset.asset_id,
          };
        }
        break;

      case 'NODE_UPDATED':
        if (payload.deviceId) {
          const asset = await syncEngine.syncDevice(payload.deviceId);
          await publishEvent({
            eventType: 'RMM_DEVICE_UPDATED',
            tenant: tenantId,
            payload: {
              asset_id: asset.asset_id,
              device_id: String(payload.deviceId),
              provider: 'ninjaone',
              updated_at: new Date().toISOString(),
            },
          });
          return {
            success: true,
            processed: true,
            action: 'device_updated',
            entityId: asset.asset_id,
          };
        }
        break;

      case 'NODE_DELETED':
      case 'NODE_APPROVAL_REJECTED':
        if (payload.deviceId) {
          await handleDeviceDeleted(tenantId, integration.integration_id, payload.deviceId);
          return {
            success: true,
            processed: true,
            action: 'device_deleted',
          };
        }
        break;
    }

    return {
      success: true,
      processed: false,
      action: 'no_device_id',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling device lifecycle event', {
      tenantId,
      activityType,
      deviceId: payload.deviceId,
      error: message,
    });
    return {
      success: false,
      processed: false,
      error: message,
    };
  }
}

/**
 * Handle device status events (reboot, login, etc.)
 */
async function handleDeviceStatusEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  if (!payload.deviceId) {
    return { success: true, processed: false, action: 'no_device_id' };
  }

  try {
    const { knex } = await createTenantKnex();
    const db = tenantDb(knex, tenantId);
    const now = new Date().toISOString();

    // Find the asset by device ID
    const assetMapping = await db.table('tenant_external_entity_mappings')
      .where({
        integration_type: 'ninjaone',
        alga_entity_type: 'asset',
        external_entity_id: String(payload.deviceId),
      })
      .first();

    if (!assetMapping) {
      // Device not synced yet, trigger a sync
      if (mapping.auto_sync_assets && mapping.client_id) {
        const syncEngine = new NinjaOneSyncEngine(tenantId, integration.integration_id);
        await syncEngine.syncDevice(payload.deviceId);
        return {
          success: true,
          processed: true,
          action: 'device_synced_on_status',
        };
      }
      return { success: true, processed: false, action: 'device_not_found' };
    }

    const activityType = payload.activityType as NinjaOneActivityType;

    // Update asset based on event type
    const updateData: Record<string, unknown> = {
      last_seen_at: now,
      agent_status: 'online',
      updated_at: now,
    };

    if (activityType === 'SYSTEM_REBOOTED') {
      // Also update the extension table for last_reboot_at
      const asset = await db.table('assets')
        .where({ asset_id: assetMapping.alga_entity_id })
        .first();

      if (asset && (asset.asset_type === 'workstation' || asset.asset_type === 'server')) {
        await db.table(`${asset.asset_type}_assets`)
          .where({ asset_id: assetMapping.alga_entity_id })
          .update({ last_reboot_at: now });
      }
    }

    await db.table('assets')
      .where({ asset_id: assetMapping.alga_entity_id })
      .update(updateData);

    // Emit online event if coming back online
    await publishEvent({
      eventType: 'RMM_DEVICE_ONLINE',
      tenant: tenantId,
      payload: {
        asset_id: assetMapping.alga_entity_id,
        device_id: String(payload.deviceId),
        provider: 'ninjaone',
        timestamp: now,
      },
    });

    return {
      success: true,
      processed: true,
      action: 'status_updated',
      entityId: assetMapping.alga_entity_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling device status event', {
      tenantId,
      deviceId: payload.deviceId,
      error: message,
    });
    return { success: false, processed: false, error: message };
  }
}

/**
 * Handle hardware change events
 */
async function handleHardwareChangeEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  if (!payload.deviceId) {
    return { success: true, processed: false, action: 'no_device_id' };
  }

  // Hardware changes require a full device sync to get updated hardware info
  if (!mapping.auto_sync_assets || !mapping.client_id) {
    return { success: true, processed: false, action: 'auto_sync_disabled' };
  }

  try {
    const syncEngine = new NinjaOneSyncEngine(tenantId, integration.integration_id);
    const asset = await syncEngine.syncDevice(payload.deviceId);

    return {
      success: true,
      processed: true,
      action: 'hardware_updated',
      entityId: asset.asset_id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling hardware change event', {
      tenantId,
      deviceId: payload.deviceId,
      error: message,
    });
    return { success: false, processed: false, error: message };
  }
}

/**
 * Alert condition events (TRIGGERED / RESET / ACKNOWLEDGED) run through the
 * shared provider-agnostic pipeline: maintenance windows, rules, dedup,
 * ticketing, and lifecycle live in @alga-psa/shared/rmm/alerts.
 */
async function handleAlertConditionEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  try {
    const event = mapNinjaOneWebhookToAlertEvent({
      tenantId,
      integrationId: integration.integration_id,
      payload,
      externalOrganizationId: mapping.external_organization_id,
    });
    if (!event) {
      return { success: true, processed: false, action: 'alert_ignored' };
    }

    const { knex } = await createTenantKnex();
    const result = await processRmmAlertEvent({ knex, deps: buildRmmAlertPipelineDeps({ logger }) }, event);

    for (const warning of result.warnings) {
      logger.warn('[NinjaOne Webhook] Alert pipeline warning', { tenantId, warning });
    }

    return {
      success: true,
      processed: result.outcome !== 'skipped',
      action: `alert_${result.outcome}`,
      entityId: result.alertId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling alert condition event', { tenantId, payload, error: message });
    return { success: false, processed: false, error: message };
  }
}

/**
 * Handle device deleted
 */
async function handleDeviceDeleted(
  tenantId: string,
  integrationId: string,
  deviceId: number
): Promise<void> {
  const { knex } = await createTenantKnex();
  const db = tenantDb(knex, tenantId);
  const now = new Date().toISOString();

  // Find the asset mapping
  const mapping = await db.table('tenant_external_entity_mappings')
    .where({
      integration_type: 'ninjaone',
      alga_entity_type: 'asset',
      external_entity_id: String(deviceId),
    })
    .first();

  if (mapping) {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      const trxDb = tenantDb(trx, tenantId);
      // Mark asset as inactive
      await trxDb.table('assets')
        .where({ asset_id: mapping.alga_entity_id })
        .update({
          status: 'inactive',
          agent_status: 'offline',
          updated_at: now,
        });

      // Update mapping
      await trxDb.table('tenant_external_entity_mappings')
        .where({
          id: mapping.id,
        })
        .update({
          sync_status: 'error',
          metadata: JSON.stringify({ deleted: true, deletedAt: now }),
          updated_at: now,
        });

      // Create history record
      await trxDb.table('asset_history').insert({
        tenant: tenantId,
        asset_id: mapping.alga_entity_id,
        changed_by: null,
        change_type: 'updated',
        changes: {
          source: 'ninjaone_webhook',
          reason: 'device_deleted_in_rmm',
          integration_id: integrationId,
        },
        changed_at: now,
      });
    });

    // Emit device deleted event
    await publishEvent({
      eventType: 'RMM_DEVICE_DELETED',
      tenant: tenantId,
      payload: {
        asset_id: mapping.alga_entity_id,
        device_id: String(deviceId),
        provider: 'ninjaone',
        deleted_at: now,
      },
    });

    logger.info('Marked asset as deleted via webhook', {
      tenantId,
      assetId: mapping.alga_entity_id,
      deviceId,
    });
  }
}
