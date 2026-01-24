'use server';

/**
 * NinjaOne Server Actions
 *
 * Server-side actions for NinjaOne RMM integration management.
 * These actions handle connection status, organization sync, and integration settings.
 */

import logger from '@alga-psa/core/logger';
import axios from 'axios';
import crypto from 'crypto';
import fs from 'fs';
import { getCurrentUser } from '@alga-psa/users/actions';
import { revalidatePath } from 'next/cache';
import { getSecretProviderInstance } from '@alga-psa/core/secrets';
import { hasPermission } from '@alga-psa/auth';
import { createTenantKnex } from '@/lib/db';
import { auditLog } from '@/lib/logging/auditLog';
import { publishWorkflowEvent } from 'server/src/lib/eventBus/publishers';
import { createNinjaOneClient, disconnectNinjaOne } from '../../integrations/ninjaone';
import { removeNinjaOneWebhook } from '../../integrations/ninjaone/webhooks/webhookRegistration';
import type { SyncOptions } from '../../integrations/ninjaone/sync/syncEngine';
import { getNinjaOneSyncStrategy } from '../../integrations/ninjaone/sync/syncStrategy';
import {
  RmmConnectionStatus,
  RmmIntegration,
  RmmOrganizationMapping,
  RmmSyncResult,
  RmmAlert,
} from '../../../interfaces/rmm.interfaces';
import { Asset } from '@/interfaces/asset.interfaces';
import {
  NINJAONE_REGIONS,
  NinjaOneRegion,
  NinjaOneOAuthCredentials,
} from '../../../interfaces/ninjaone.interfaces';
import { buildIntegrationDisconnectedPayload } from '@shared/workflow/streams/domainEventBuilders/integrationConnectionEventBuilders';

// Secret names for NinjaOne credentials
const NINJAONE_CREDENTIALS_SECRET = 'ninjaone_credentials';
const NINJAONE_CLIENT_ID_SECRET = 'ninjaone_client_id';
const NINJAONE_CLIENT_SECRET_SECRET = 'ninjaone_client_secret';
const NINJAONE_SCOPES = 'monitoring management offline_access';

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

const readNgrokUrl = () => {
  try {
    if (fs.existsSync(NGROK_URL_FILE)) {
      const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
      if (ngrokUrl) {
        return ngrokUrl;
      }
    }
  } catch {
    // Ignore file read errors, fall back to env vars
  }
  return null;
};

// Redirect URI - priority: NINJAONE_REDIRECT_URI, ngrok file, NEXTAUTH_URL
const getRedirectUri = () => {
  if (process.env.NINJAONE_REDIRECT_URI) {
    return process.env.NINJAONE_REDIRECT_URI;
  }

  const ngrokUrl = readNgrokUrl();
  if (ngrokUrl) {
    return `${ngrokUrl}/api/integrations/ninjaone/callback`;
  }

  const baseUrl = process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
  return `${baseUrl}/api/integrations/ninjaone/callback`;
};

/**
 * Extract safe error info for logging (avoids circular reference issues with axios errors)
 */
function extractErrorInfo(error: unknown): object {
  if (axios.isAxiosError(error)) {
    return {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      url: error.config?.url,
    };
  }
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }
  return { message: String(error) };
}

/**
 * Save NinjaOne API credentials for a tenant
 * These credentials are used for OAuth authentication with NinjaOne
 */
export async function saveNinjaOneCredentials(
  clientId: string,
  clientSecret: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update NinjaOne settings');
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Validate inputs
    if (!clientId || !clientId.trim()) {
      throw new Error('Client ID is required');
    }
    if (!clientSecret || !clientSecret.trim()) {
      throw new Error('Client Secret is required');
    }

    // Store credentials in tenant secrets
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(tenant, NINJAONE_CLIENT_ID_SECRET, clientId.trim());
    await secretProvider.setTenantSecret(tenant, NINJAONE_CLIENT_SECRET_SECRET, clientSecret.trim());

    logger.info('[NinjaOneActions] Successfully saved NinjaOne credentials', { tenant });
    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error saving NinjaOne credentials:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the status of stored NinjaOne credentials
 * Returns whether credentials exist and a masked version of the secret
 */
export async function getNinjaOneCredentialsStatus(): Promise<{
  hasCredentials: boolean;
  clientId?: string;
  clientSecretMasked?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'settings', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view NinjaOne settings');
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const secretProvider = await getSecretProviderInstance();
    const clientId = await secretProvider.getTenantSecret(tenant, NINJAONE_CLIENT_ID_SECRET);
    const clientSecret = await secretProvider.getTenantSecret(tenant, NINJAONE_CLIENT_SECRET_SECRET);

    if (!clientId || !clientSecret) {
      return { hasCredentials: false };
    }

    // Mask the client secret - show only last 4 characters
    const maskedSecret = clientSecret.length > 4
      ? '•'.repeat(clientSecret.length - 4) + clientSecret.slice(-4)
      : '•'.repeat(clientSecret.length);

    return {
      hasCredentials: true,
      clientId,
      clientSecretMasked: maskedSecret,
    };
  } catch (error) {
    logger.error('[NinjaOneActions] Error getting NinjaOne credentials status:', extractErrorInfo(error));
    return { hasCredentials: false };
  }
}

/**
 * Clear NinjaOne API credentials for a tenant
 */
export async function clearNinjaOneCredentials(): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update NinjaOne settings');
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const secretProvider = await getSecretProviderInstance();
    await secretProvider.deleteTenantSecret(tenant, NINJAONE_CLIENT_ID_SECRET);
    await secretProvider.deleteTenantSecret(tenant, NINJAONE_CLIENT_SECRET_SECRET);

    logger.info('[NinjaOneActions] Successfully cleared NinjaOne credentials', { tenant });
    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error clearing NinjaOne credentials:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the current NinjaOne connection status
 */
export async function getNinjaOneConnectionStatus(): Promise<RmmConnectionStatus> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'settings', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view NinjaOne settings');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration record
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      return {
        provider: 'ninjaone',
        is_connected: false,
        is_active: false,
      };
    }

    // Check if we have valid credentials
    const secretProvider = await getSecretProviderInstance();
    const credentialsJson = await secretProvider.getTenantSecret(tenant, NINJAONE_CREDENTIALS_SECRET);
    const hasCredentials = !!credentialsJson;

    // Get organization and device counts
    const orgCount = await knex('rmm_organization_mappings')
      .where({ tenant, integration_id: integration.integration_id })
      .count('mapping_id as count')
      .first();

    // Get active alert count
    const alertCount = await knex('rmm_alerts')
      .where({ tenant, integration_id: integration.integration_id, status: 'active' })
      .count('alert_id as count')
      .first();

    return {
      provider: 'ninjaone',
      is_connected: hasCredentials && integration.is_active,
      is_active: integration.is_active,
      instance_url: integration.instance_url || undefined,
      connected_at: integration.connected_at || undefined,
      last_sync_at: integration.last_sync_at || undefined,
      sync_status: integration.sync_status as RmmConnectionStatus['sync_status'],
      sync_error: integration.sync_error || undefined,
      organization_count: Number(orgCount?.count) || 0,
      active_alert_count: Number(alertCount?.count) || 0,
    };
  } catch (error) {
    logger.error('[NinjaOneActions] Error getting connection status:', extractErrorInfo(error));
    return {
      provider: 'ninjaone',
      is_connected: false,
      is_active: false,
    };
  }
}

/**
 * Disconnect NinjaOne integration
 */
export async function disconnectNinjaOneIntegration(): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to disconnect NinjaOne');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // 1. Try to remove webhook from NinjaOne before clearing credentials
    // This is best-effort - we proceed even if it fails
    try {
      const client = await createNinjaOneClient(tenant);
      const webhookResult = await removeNinjaOneWebhook(client, tenant);
      if (webhookResult.success) {
        logger.info('[NinjaOneActions] Successfully removed webhook from NinjaOne', { tenant });
      } else {
        logger.warn('[NinjaOneActions] Failed to remove webhook (may not exist)', {
          tenant,
          error: webhookResult.error
        });
      }
    } catch (webhookError) {
      // Log but don't fail - webhook may already be removed or credentials may be invalid
      logger.warn('[NinjaOneActions] Error removing webhook during disconnect', {
        tenant,
        error: extractErrorInfo(webhookError),
      });
    }

    // 2. Remove OAuth token credentials from secret storage
    await disconnectNinjaOne(tenant);

    // 3. Remove client credentials (client ID and secret) from secret storage
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.deleteTenantSecret(tenant, NINJAONE_CLIENT_ID_SECRET);
    await secretProvider.deleteTenantSecret(tenant, NINJAONE_CLIENT_SECRET_SECRET);
    logger.info('[NinjaOneActions] Cleared NinjaOne client credentials', { tenant });

    // 4. Update integration record (clear webhook-related settings)
    const existingIntegration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first();

    if (existingIntegration) {
      // Parse existing settings - handle both string and object cases
      let settings: Record<string, any> = {};
      if (existingIntegration.settings) {
        if (typeof existingIntegration.settings === 'string') {
          try {
            settings = JSON.parse(existingIntegration.settings);
          } catch (e) {
            logger.warn('[NinjaOneActions] Failed to parse existing settings during disconnect, using empty object:', e);
            settings = {};
          }
        } else if (typeof existingIntegration.settings === 'object') {
          settings = existingIntegration.settings as Record<string, any>;
        }
      }
      
      // Remove webhook-related settings
      delete settings.webhookSecret;
      delete settings.webhookRegisteredAt;

      await knex('rmm_integrations')
        .where({ tenant, provider: 'ninjaone' })
        .update({
          is_active: false,
          sync_status: 'pending',
          sync_error: null,
          settings: JSON.stringify(settings),
          updated_at: knex.fn.now(),
        });
    }

    // Emit workflow v2 integration disconnected event (best-effort)
    if (existingIntegration?.integration_id) {
      const disconnectedAt = new Date().toISOString();
      try {
        await publishWorkflowEvent({
          eventType: 'INTEGRATION_DISCONNECTED',
          payload: buildIntegrationDisconnectedPayload({
            integrationId: existingIntegration.integration_id,
            provider: 'ninjaone',
            connectionId: existingIntegration.integration_id,
            disconnectedAt,
            disconnectedByUserId: user.user_id,
            reason: 'user_requested',
          }),
          ctx: {
            tenantId: tenant,
            actor: { actorType: 'USER', actorUserId: user.user_id },
            occurredAt: disconnectedAt,
          },
          idempotencyKey: `integration_disconnected:${tenant}:${existingIntegration.integration_id}:${disconnectedAt}`,
        });
      } catch (publishError) {
        logger.warn('[NinjaOneActions] Failed to publish workflow INTEGRATION_DISCONNECTED event', {
          tenant,
          error: extractErrorInfo(publishError),
        });
      }
    }

    logger.info('[NinjaOneActions] Successfully disconnected NinjaOne', { tenant });
    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error disconnecting NinjaOne:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Test the NinjaOne connection
 */
export async function testNinjaOneConnection(): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'settings', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to test NinjaOne connection');
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Create client and test connection
    const client = await createNinjaOneClient(tenant);
    const isConnected = await client.testConnection();

    if (!isConnected) {
      return { success: false, error: 'Failed to connect to NinjaOne API' };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error testing NinjaOne connection:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Sync organizations from NinjaOne
 */
export async function syncNinjaOneOrganizations(): Promise<RmmSyncResult> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to sync NinjaOne organizations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    const strategy = getNinjaOneSyncStrategy();
    const result = await strategy.syncOrganizations({
      tenantId: tenant,
      integrationId: integration.integration_id,
      performedBy: user.user_id,
    });

    revalidatePath('/msp/settings');

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error syncing organizations:', extractErrorInfo(error));

    // Try to update sync status to error
    try {
      const { knex, tenant } = await createTenantKnex();
      await knex('rmm_integrations')
        .where({ tenant, provider: 'ninjaone' })
        .update({
          sync_status: 'error',
          sync_error: errorMessage,
          updated_at: knex.fn.now(),
        });
    } catch (updateError) {
      // Ignore update errors
    }

    return {
      success: false,
      provider: 'ninjaone',
      sync_type: 'organizations',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_failed: 1,
      errors: [errorMessage],
    };
  }
}

/**
 * Get organization mappings
 */
export async function getNinjaOneOrganizationMappings(): Promise<RmmOrganizationMapping[]> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'settings', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view NinjaOne organizations');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      return [];
    }

    // Get mappings with company names
    const mappings = await knex('rmm_organization_mappings as rom')
      .leftJoin('clients as c', function() {
        this.on('rom.tenant', '=', 'c.tenant')
          .andOn('rom.client_id', '=', 'c.client_id');
      })
      .where('rom.tenant', tenant)
      .where('rom.integration_id', integration.integration_id)
      .select(
        'rom.*',
        'c.client_name as company_name'
      )
      .orderBy('rom.external_organization_name');

    return mappings.map(m => ({
      ...m,
      metadata: typeof m.metadata === 'string' ? JSON.parse(m.metadata) : m.metadata || {},
    }));
  } catch (error) {
    logger.error('[NinjaOneActions] Error getting organization mappings:', extractErrorInfo(error));
    return [];
  }
}

/**
 * Update organization mapping
 */
export async function updateNinjaOneOrganizationMapping(
  mappingId: string,
  updates: {
    company_id?: string | null;
    auto_sync_assets?: boolean;
    auto_create_tickets?: boolean;
  }
): Promise<{ success: boolean; error?: string }> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to update NinjaOne mapping');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Map company_id to client_id (database column name)
    const dbUpdates: Record<string, unknown> = {};
    if ('company_id' in updates) {
      dbUpdates.client_id = updates.company_id;
    }
    if ('auto_sync_assets' in updates) {
      dbUpdates.auto_sync_assets = updates.auto_sync_assets;
    }
    if ('auto_create_tickets' in updates) {
      dbUpdates.auto_create_tickets = updates.auto_create_tickets;
    }

    await knex('rmm_organization_mappings')
      .where({ tenant, mapping_id: mappingId })
      .update({
        ...dbUpdates,
        updated_at: knex.fn.now(),
      });

    revalidatePath('/msp/settings');

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error updating organization mapping:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Get connect URL for NinjaOne OAuth
 */
export async function getNinjaOneConnectUrl(region: NinjaOneRegion = 'US'): Promise<string> {
  if (!NINJAONE_REGIONS[region]) {
    throw new Error(`Invalid region: ${region}`);
  }

  const user = await getCurrentUser();
  if (!user || !user.tenant) {
    throw new Error('User not authenticated');
  }

  const canView = await hasPermission(user, 'settings', 'read');
  if (!canView) {
    throw new Error('Insufficient permissions to view NinjaOne settings');
  }

  const { tenant } = await createTenantKnex();
  if (!tenant) {
    throw new Error('Tenant not found');
  }

  const secretProvider = await getSecretProviderInstance();
  const clientId = await secretProvider.getTenantSecret(tenant, NINJAONE_CLIENT_ID_SECRET);
  if (!clientId) {
    throw new Error('NinjaOne client ID not configured for this tenant.');
  }

  const csrfToken = crypto.randomBytes(16).toString('hex');
  const statePayload = {
    tenantId: tenant,
    region,
    csrf: csrfToken,
    timestamp: Date.now(),
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

  const instanceUrl = NINJAONE_REGIONS[region];
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    scope: NINJAONE_SCOPES,
    redirect_uri: redirectUri,
    state,
  });

  return `${instanceUrl}/oauth/authorize?${params.toString()}`;
}

/**
 * Trigger a full device sync
 */
export async function triggerNinjaOneFullSync(
  options?: Partial<SyncOptions>
): Promise<RmmSyncResult> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to trigger sync');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    const strategy = getNinjaOneSyncStrategy();
    const result = await strategy.syncDevicesFull({
      tenantId: tenant,
      integrationId: integration.integration_id,
      options: {
        ...options,
        performedBy: user.user_id,
      },
    });

    revalidatePath('/msp/settings');
    revalidatePath('/msp/assets');

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error triggering full sync:', extractErrorInfo(error));
    return {
      success: false,
      sync_type: 'full',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      errors: [errorMessage],
    };
  }
}

/**
 * Trigger an incremental device sync
 */
export async function triggerNinjaOneIncrementalSync(): Promise<RmmSyncResult> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'settings', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to trigger sync');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    // Determine the since date (use last incremental sync, or last full sync, or 24 hours ago)
    const since = integration.last_incremental_sync_at
      || integration.last_full_sync_at
      || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Run the sync
    const strategy = getNinjaOneSyncStrategy();
    const result = await strategy.syncDevicesIncremental({
      tenantId: tenant,
      integrationId: integration.integration_id,
      since: new Date(since),
      options: { performedBy: user.user_id },
    });

    revalidatePath('/msp/settings');
    revalidatePath('/msp/assets');

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error triggering incremental sync:', extractErrorInfo(error));
    return {
      success: false,
      sync_type: 'incremental',
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      items_processed: 0,
      items_created: 0,
      items_updated: 0,
      items_deleted: 0,
      items_failed: 0,
      errors: [errorMessage],
    };
  }
}

/**
 * Sync a single device by its NinjaOne ID
 */
export async function syncNinjaOneDevice(deviceId: number): Promise<{
  success: boolean;
  asset?: Asset;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'asset', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to sync device');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    // Sync the device
    const strategy = getNinjaOneSyncStrategy();
    const asset = await strategy.syncDevice({
      tenantId: tenant,
      integrationId: integration.integration_id,
      deviceId,
    });

    revalidatePath('/msp/assets');
    revalidatePath(`/msp/assets/${asset.asset_id}`);

    return { success: true, asset };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error syncing device:', { deviceId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Get remote access URL for a device
 */
export async function getNinjaOneRemoteAccessUrl(assetId: string): Promise<{
  success: boolean;
  url?: string;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'asset', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to access remote tools');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get the asset to find the RMM device ID
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      throw new Error('Asset is not managed by NinjaOne');
    }

    // Create client and get remote access URL
    const client = await createNinjaOneClient(tenant);
    const linkInfo = await client.getDeviceLink(parseInt(asset.rmm_device_id, 10));
    const url = linkInfo.url;

    // Log remote access for audit trail
    logger.info('[NinjaOneActions] Remote access URL requested', {
      tenant,
      assetId,
      deviceId: asset.rmm_device_id,
      userId: user.user_id,
    });

    // Write formal audit log entry
    try {
      await auditLog(knex, {
        userId: user.user_id,
        operation: 'REMOTE_ACCESS_INITIATED',
        tableName: 'assets',
        recordId: assetId,
        changedData: {},
        details: {
          action: 'remote_access',
          provider: 'ninjaone',
          rmm_device_id: asset.rmm_device_id,
          asset_name: asset.name,
          user_email: user.email,
          user_name: `${user.first_name} ${user.last_name}`,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (auditError) {
      // Don't fail the request if audit logging fails, just log the error
      logger.warn('[NinjaOneActions] Failed to write audit log for remote access', { error: auditError });
    }

    return { success: true, url };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error getting remote access URL:', { assetId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Get active RMM alerts for an asset
 */
export async function getAssetAlerts(assetId: string): Promise<{
  success: boolean;
  alerts?: RmmAlert[];
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'asset', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view alerts');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get the asset to verify RMM management
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (!asset.rmm_provider || !asset.rmm_device_id) {
      return { success: true, alerts: [] };
    }

    // Get alerts for this asset
    const alerts = await knex('rmm_alerts')
      .where({ tenant, asset_id: assetId })
      .whereIn('status', ['active', 'acknowledged'])
      .orderBy('triggered_at', 'desc')
      .limit(50);

    return {
      success: true,
      alerts: alerts.map(a => ({
        ...a,
        source_data: typeof a.source_data === 'string' ? JSON.parse(a.source_data) : a.source_data,
      })),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error getting asset alerts:', { assetId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Acknowledge an RMM alert
 */
export async function acknowledgeRmmAlert(alertId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'asset', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to acknowledge alerts');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Update the alert
    const updated = await knex('rmm_alerts')
      .where({ tenant, alert_id: alertId })
      .update({
        status: 'acknowledged',
        acknowledged_at: knex.fn.now(),
        acknowledged_by: user.user_id,
        updated_at: knex.fn.now(),
      });

    if (updated === 0) {
      throw new Error('Alert not found');
    }

    logger.info('[NinjaOneActions] Alert acknowledged', { alertId, userId: user.user_id });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error acknowledging alert:', { alertId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Create a ticket from an RMM alert
 */
export async function createTicketFromRmmAlert(alertId: string): Promise<{
  success: boolean;
  ticketId?: string;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canCreate = await hasPermission(user, 'ticket', 'create');
    if (!canCreate) {
      throw new Error('Insufficient permissions to create tickets');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get the alert with asset info
    const alert = await knex('rmm_alerts as a')
      .leftJoin('assets as ast', function() {
        this.on('a.tenant', '=', 'ast.tenant')
          .andOn('a.asset_id', '=', 'ast.asset_id');
      })
      .where('a.tenant', tenant)
      .where('a.alert_id', alertId)
      .select('a.*', 'ast.name as asset_name', 'ast.company_id')
      .first();

    if (!alert) {
      throw new Error('Alert not found');
    }

    if (alert.ticket_id) {
      throw new Error('Ticket already created for this alert');
    }

    // Import ticket creator dynamically to avoid circular dependencies
    const { createTicketFromAlert } = await import('../../integrations/ninjaone/alerts/ticketCreator');

    const ticket = await createTicketFromAlert(tenant, alert as RmmAlert, {
      performedBy: user.user_id,
    });

    // Update the alert with ticket reference
    await knex('rmm_alerts')
      .where({ tenant, alert_id: alertId })
      .update({
        ticket_id: ticket.ticket_id,
        auto_ticket_created: false, // Manual creation
        updated_at: knex.fn.now(),
      });

    logger.info('[NinjaOneActions] Ticket created from alert', { alertId, ticketId: ticket.ticket_id });

    return { success: true, ticketId: ticket.ticket_id };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error creating ticket from alert:', { alertId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Get NinjaOne device details for an asset
 */
export async function getNinjaOneDeviceDetails(assetId: string): Promise<{
  success: boolean;
  device?: any;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'asset', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view device details');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get the asset to find the RMM device ID
    const asset = await knex('assets')
      .where({ tenant, asset_id: assetId })
      .first();

    if (!asset) {
      throw new Error('Asset not found');
    }

    if (asset.rmm_provider !== 'ninjaone' || !asset.rmm_device_id) {
      throw new Error('Asset is not managed by NinjaOne');
    }

    // Create client and get device details
    const client = await createNinjaOneClient(tenant);
    const device = await client.getDevice(parseInt(asset.rmm_device_id, 10));

    return { success: true, device };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error getting device details:', { assetId, error });
    return { success: false, error: errorMessage };
  }
}

/**
 * Trigger patch status sync for all RMM-managed assets
 */
export async function triggerPatchStatusSync(options?: {
  assetIds?: string[];
}): Promise<{
  success: boolean;
  result?: {
    assetsProcessed: number;
    assetsUpdated: number;
    assetsFailed: number;
  };
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'asset', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to sync patch status');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    // Import patch sync dynamically
    const { syncPatchStatus } = await import('../../integrations/ninjaone/sync/patchSync');

    const result = await syncPatchStatus(tenant, integration.integration_id, {
      assetIds: options?.assetIds,
      performedBy: user.user_id,
    });

    revalidatePath('/msp/assets');

    return {
      success: result.success,
      result: {
        assetsProcessed: result.assetsProcessed,
        assetsUpdated: result.assetsUpdated,
        assetsFailed: result.assetsFailed,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error triggering patch sync:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Trigger software inventory sync for all RMM-managed assets
 */
export async function triggerSoftwareInventorySync(options?: {
  assetIds?: string[];
  trackChanges?: boolean;
}): Promise<{
  success: boolean;
  result?: {
    assetsProcessed: number;
    assetsUpdated: number;
    assetsFailed: number;
    totalSoftwareItems: number;
  };
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canUpdate = await hasPermission(user, 'asset', 'update');
    if (!canUpdate) {
      throw new Error('Insufficient permissions to sync software inventory');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get integration
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .first() as RmmIntegration | undefined;

    if (!integration) {
      throw new Error('NinjaOne integration not configured');
    }

    // Import software sync dynamically
    const { syncSoftwareInventory } = await import('../../integrations/ninjaone/sync/softwareSync');

    const result = await syncSoftwareInventory(tenant, integration.integration_id, {
      assetIds: options?.assetIds,
      trackChanges: options?.trackChanges ?? true,
      performedBy: user.user_id,
    });

    revalidatePath('/msp/assets');

    return {
      success: result.success,
      result: {
        assetsProcessed: result.assetsProcessed,
        assetsUpdated: result.assetsUpdated,
        assetsFailed: result.assetsFailed,
        totalSoftwareItems: result.totalSoftwareItems,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error triggering software sync:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Search for software across all assets
 */
export async function searchSoftware(
  searchTerm: string,
  options?: {
    companyId?: string;
    limit?: number;
  }
): Promise<{
  success: boolean;
  results?: Array<{
    assetId: string;
    assetName: string;
    companyId: string;
    clientName: string;
    software: {
      softwareId: string;
      name: string;
      version: string | null;
      publisher: string | null;
      category: string | null;
      installDate: string | null;
    };
  }>;
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'asset', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to search software');
    }

    const { tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Import software sync dynamically
    const { searchSoftwareAcrossAssets } = await import('../../integrations/ninjaone/sync/softwareSync');

    const results = await searchSoftwareAcrossAssets(tenant, searchTerm, {
      companyId: options?.companyId,
      limit: options?.limit,
    });

    return { success: true, results };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error searching software:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}

/**
 * Get compliance summary for RMM-managed assets
 */
export async function getRmmComplianceSummary(): Promise<{
  success: boolean;
  summary?: {
    totalDevices: number;
    devicesOnline: number;
    devicesOffline: number;
    devicesWithAlerts: number;
    devicesNeedingPatches: number;
    patchesPending: number;
    patchesFailed: number;
    lastSyncAt?: string;
  };
  error?: string;
}> {
  try {
    const user = await getCurrentUser();
    if (!user || !user.tenant) {
      throw new Error('User not authenticated');
    }

    // Check permission
    const canView = await hasPermission(user, 'asset', 'read');
    if (!canView) {
      throw new Error('Insufficient permissions to view compliance summary');
    }

    const { knex, tenant } = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    // Get total RMM-managed devices
    const totalDevicesResult = await knex('assets')
      .where({ tenant })
      .where('rmm_provider', 'ninjaone')
      .whereNotNull('rmm_device_id')
      .count('asset_id as count')
      .first();

    // Get devices by status
    const devicesByStatus = await knex('assets')
      .where({ tenant })
      .where('rmm_provider', 'ninjaone')
      .whereNotNull('rmm_device_id')
      .select('agent_status')
      .count('asset_id as count')
      .groupBy('agent_status');

    const statusCounts: Record<string, number> = {};
    devicesByStatus.forEach(row => {
      statusCounts[row.agent_status || 'unknown'] = Number(row.count);
    });

    // Get devices with active alerts
    const devicesWithAlertsResult = await knex('rmm_alerts')
      .where({ tenant, status: 'active' })
      .countDistinct('asset_id as count')
      .first();

    // Get patch statistics from workstations
    const workstationPatches = await knex('workstation_assets as aw')
      .join('assets as a', function() {
        this.on('aw.tenant', '=', 'a.tenant')
          .andOn('aw.asset_id', '=', 'a.asset_id');
      })
      .where('aw.tenant', tenant)
      .where('a.rmm_provider', 'ninjaone')
      .select(
        knex.raw('COALESCE(SUM(COALESCE(aw.pending_patches, 0)), 0) as pending'),
        knex.raw('COALESCE(SUM(COALESCE(aw.failed_patches, 0)), 0) as failed'),
        knex.raw('COUNT(CASE WHEN COALESCE(aw.pending_patches, 0) > 0 THEN 1 END) as needing_patches')
      )
      .first<{ pending: string | number; failed: string | number; needing_patches: string | number }>();

    // Get patch statistics from servers
    const serverPatches = await knex('server_assets as asrv')
      .join('assets as a', function() {
        this.on('asrv.tenant', '=', 'a.tenant')
          .andOn('asrv.asset_id', '=', 'a.asset_id');
      })
      .where('asrv.tenant', tenant)
      .where('a.rmm_provider', 'ninjaone')
      .select(
        knex.raw('COALESCE(SUM(COALESCE(asrv.pending_patches, 0)), 0) as pending'),
        knex.raw('COALESCE(SUM(COALESCE(asrv.failed_patches, 0)), 0) as failed'),
        knex.raw('COUNT(CASE WHEN COALESCE(asrv.pending_patches, 0) > 0 THEN 1 END) as needing_patches')
      )
      .first<{ pending: string | number; failed: string | number; needing_patches: string | number }>();

    // Get last sync time
    const integration = await knex('rmm_integrations')
      .where({ tenant, provider: 'ninjaone' })
      .select('last_sync_at')
      .first();

    const totalPending = Number(workstationPatches?.pending || 0) + Number(serverPatches?.pending || 0);
    const totalFailed = Number(workstationPatches?.failed || 0) + Number(serverPatches?.failed || 0);
    const devicesNeedingPatches = Number(workstationPatches?.needing_patches || 0) + Number(serverPatches?.needing_patches || 0);

    return {
      success: true,
      summary: {
        totalDevices: Number(totalDevicesResult?.count || 0),
        devicesOnline: statusCounts['online'] || 0,
        devicesOffline: statusCounts['offline'] || 0,
        devicesWithAlerts: Number(devicesWithAlertsResult?.count || 0),
        devicesNeedingPatches,
        patchesPending: totalPending,
        patchesFailed: totalFailed,
        lastSyncAt: integration?.last_sync_at,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('[NinjaOneActions] Error getting compliance summary:', extractErrorInfo(error));
    return { success: false, error: errorMessage };
  }
}
