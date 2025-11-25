/**
 * NinjaOne Webhook Handler
 *
 * Processes webhook events from NinjaOne RMM platform.
 * Handles device lifecycle events, alerts, and status changes.
 */

import { Knex } from 'knex';
import crypto from 'crypto';
import { createTenantKnex } from '../../../../../../../server/src/lib/db';
import { withTransaction } from '@shared/db';
import logger from '@shared/core/logger';
import { publishEvent } from '@shared/workflow/streams/eventPublisher';
import { NinjaOneSyncEngine } from '../sync/syncEngine';
import {
  NinjaOneWebhookPayload,
  NinjaOneActivityType,
  NinjaOneAlertSeverity,
  mapAlertSeverity,
  mapAlertPriority,
} from '../../../../interfaces/ninjaone.interfaces';
import {
  RmmIntegration,
  RmmOrganizationMapping,
  RmmAlert,
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

  // Find the organization mapping to get tenant and integration
  const result = await knex('rmm_organization_mappings as rom')
    .join('rmm_integrations as ri', function() {
      this.on('rom.integration_id', '=', 'ri.integration_id')
        .andOn('rom.tenant', '=', 'ri.tenant');
    })
    .where('rom.external_org_id', String(organizationId))
    .where('ri.provider', 'ninjaone')
    .where('ri.is_active', true)
    .first<{
      tenant: string;
      integration_id: string;
      provider: string;
      is_active: boolean;
      instance_url: string | null;
      webhook_secret: string | null;
      mapping_id: string;
      external_org_id: string;
      external_org_name: string | null;
      client_id: string | null;
      auto_sync_devices: boolean;
    }>(
      'rom.tenant',
      'ri.integration_id',
      'ri.provider',
      'ri.is_active',
      'ri.instance_url',
      'ri.webhook_secret',
      'rom.mapping_id',
      'rom.external_org_id',
      'rom.external_org_name',
      'rom.client_id',
      'rom.auto_sync_devices'
    );

  if (!result) {
    return null;
  }

  return {
    tenantId: result.tenant,
    integration: {
      tenant: result.tenant,
      integration_id: result.integration_id,
      provider: 'ninjaone',
      is_active: result.is_active,
      instance_url: result.instance_url || undefined,
      webhook_secret: result.webhook_secret || undefined,
    } as RmmIntegration,
    mapping: {
      tenant: result.tenant,
      mapping_id: result.mapping_id,
      integration_id: result.integration_id,
      external_org_id: result.external_org_id,
      external_org_name: result.external_org_name || undefined,
      client_id: result.client_id || undefined,
      auto_sync_devices: result.auto_sync_devices,
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
      event_type: 'RMM_WEBHOOK_RECEIVED',
      payload: {
        tenant: tenantId,
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

  // Route to appropriate handler
  const activityType = payload.activityType as NinjaOneActivityType;

  // Check if this is an alert (CONDITION type with TRIGGERED status)
  if (payload.type === 'CONDITION' && payload.status === 'TRIGGERED') {
    return handleAlertEvent(tenantId, integration, mapping, payload);
  }

  // Check if this is an alert reset
  if (payload.type === 'CONDITION' && payload.status === 'RESET') {
    return handleAlertResetEvent(tenantId, integration, mapping, payload);
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
  if (!mapping.auto_sync_devices) {
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
            event_type: 'RMM_DEVICE_CREATED',
            payload: {
              tenant: tenantId,
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
            event_type: 'RMM_DEVICE_UPDATED',
            payload: {
              tenant: tenantId,
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
    const now = new Date().toISOString();

    // Find the asset by device ID
    const assetMapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant: tenantId,
        integration_type: 'ninjaone',
        alga_entity_type: 'asset',
        external_entity_id: String(payload.deviceId),
      })
      .first();

    if (!assetMapping) {
      // Device not synced yet, trigger a sync
      if (mapping.auto_sync_devices && mapping.client_id) {
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
      const asset = await knex('assets')
        .where({ tenant: tenantId, asset_id: assetMapping.alga_entity_id })
        .first();

      if (asset && (asset.asset_type === 'workstation' || asset.asset_type === 'server')) {
        await knex(`${asset.asset_type}_assets`)
          .where({ tenant: tenantId, asset_id: assetMapping.alga_entity_id })
          .update({ last_reboot_at: now });
      }
    }

    await knex('assets')
      .where({ tenant: tenantId, asset_id: assetMapping.alga_entity_id })
      .update(updateData);

    // Emit online event if coming back online
    await publishEvent({
      event_type: 'RMM_DEVICE_ONLINE',
      payload: {
        tenant: tenantId,
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
  if (!mapping.auto_sync_devices || !mapping.client_id) {
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
 * Handle alert triggered event
 */
async function handleAlertEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  try {
    const { knex } = await createTenantKnex();
    const now = new Date().toISOString();

    // Find the asset if device ID is provided
    let assetId: string | undefined;
    if (payload.deviceId) {
      const assetMapping = await knex('tenant_external_entity_mappings')
        .where({
          tenant: tenantId,
          integration_type: 'ninjaone',
          alga_entity_type: 'asset',
          external_entity_id: String(payload.deviceId),
        })
        .first();
      assetId = assetMapping?.alga_entity_id;
    }

    // Determine severity and priority
    const severity = payload.severity || 'NONE';
    const priority = payload.priority || mapAlertPriority(severity as NinjaOneAlertSeverity);

    // Create or update alert record
    const existingAlert = await knex('rmm_alerts')
      .where({
        tenant: tenantId,
        integration_id: integration.integration_id,
        external_alert_id: payload.activityId?.toString() || payload.id?.toString(),
      })
      .first();

    let alertId: string;

    if (existingAlert) {
      // Update existing alert
      await knex('rmm_alerts')
        .where({ tenant: tenantId, alert_id: existingAlert.alert_id })
        .update({
          status: 'active',
          updated_at: now,
        });
      alertId = existingAlert.alert_id;
    } else {
      // Create new alert
      const [alert] = await knex('rmm_alerts')
        .insert({
          tenant: tenantId,
          integration_id: integration.integration_id,
          external_alert_id: payload.activityId?.toString() || payload.id?.toString(),
          external_device_id: payload.deviceId?.toString(),
          asset_id: assetId,
          severity: mapAlertSeverity(severity as NinjaOneAlertSeverity),
          priority,
          activity_type: payload.activityType,
          status: 'active',
          message: payload.message || payload.statusCode,
          source_data: JSON.stringify(payload),
          triggered_at: payload.activityTime || now,
          created_at: now,
          updated_at: now,
        })
        .returning('alert_id');

      alertId = alert.alert_id;
    }

    // Emit alert triggered event
    await publishEvent({
      event_type: 'RMM_ALERT_TRIGGERED',
      payload: {
        tenant: tenantId,
        alert_id: alertId,
        asset_id: assetId,
        device_id: payload.deviceId?.toString(),
        severity,
        priority,
        activity_type: payload.activityType,
        message: payload.message || payload.statusCode,
        provider: 'ninjaone',
        triggered_at: payload.activityTime || now,
      },
    });

    return {
      success: true,
      processed: true,
      action: 'alert_created',
      entityId: alertId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling alert event', {
      tenantId,
      payload,
      error: message,
    });
    return { success: false, processed: false, error: message };
  }
}

/**
 * Handle alert reset event
 */
async function handleAlertResetEvent(
  tenantId: string,
  integration: RmmIntegration,
  mapping: RmmOrganizationMapping,
  payload: NinjaOneWebhookPayload
): Promise<WebhookProcessingResult> {
  try {
    const { knex } = await createTenantKnex();
    const now = new Date().toISOString();

    // Find and update the alert
    const alert = await knex('rmm_alerts')
      .where({
        tenant: tenantId,
        integration_id: integration.integration_id,
        external_alert_id: payload.activityId?.toString() || payload.id?.toString(),
      })
      .first();

    if (alert) {
      await knex('rmm_alerts')
        .where({ tenant: tenantId, alert_id: alert.alert_id })
        .update({
          status: 'resolved',
          resolved_at: now,
          updated_at: now,
        });

      // Emit alert resolved event
      await publishEvent({
        event_type: 'RMM_ALERT_RESOLVED',
        payload: {
          tenant: tenantId,
          alert_id: alert.alert_id,
          asset_id: alert.asset_id,
          device_id: payload.deviceId?.toString(),
          provider: 'ninjaone',
          resolved_at: now,
        },
      });

      return {
        success: true,
        processed: true,
        action: 'alert_resolved',
        entityId: alert.alert_id,
      };
    }

    return {
      success: true,
      processed: false,
      action: 'alert_not_found',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Error handling alert reset event', {
      tenantId,
      payload,
      error: message,
    });
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
  const now = new Date().toISOString();

  // Find the asset mapping
  const mapping = await knex('tenant_external_entity_mappings')
    .where({
      tenant: tenantId,
      integration_type: 'ninjaone',
      alga_entity_type: 'asset',
      external_entity_id: String(deviceId),
    })
    .first();

  if (mapping) {
    await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Mark asset as inactive
      await trx('assets')
        .where({ tenant: tenantId, asset_id: mapping.alga_entity_id })
        .update({
          status: 'inactive',
          agent_status: 'offline',
          updated_at: now,
        });

      // Update mapping
      await trx('tenant_external_entity_mappings')
        .where({
          tenant: tenantId,
          id: mapping.id,
        })
        .update({
          sync_status: 'error',
          metadata: JSON.stringify({ deleted: true, deletedAt: now }),
          updated_at: now,
        });

      // Create history record
      await trx('asset_history').insert({
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
      event_type: 'RMM_DEVICE_DELETED',
      payload: {
        tenant: tenantId,
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
