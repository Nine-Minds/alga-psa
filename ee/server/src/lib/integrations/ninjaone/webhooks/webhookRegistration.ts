/**
 * NinjaOne Webhook Registration Service
 *
 * Handles automatic registration and removal of webhooks with the NinjaOne API.
 * Webhooks are registered after OAuth authentication to enable real-time notifications.
 */

import crypto from 'crypto';
import fs from 'fs';
import { NinjaOneClient } from '../ninjaOneClient';
import {
  WebhookConfiguration,
  NINJAONE_WEBHOOK_STATUS_CODES,
} from '../../../../interfaces/ninjaone.interfaces';
import logger from '@alga-psa/core/logger';

// Header name for webhook authentication
const WEBHOOK_AUTH_HEADER = 'X-Alga-Webhook-Secret';

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

/**
 * Get the webhook base URL dynamically.
 * Priority:
 *   1. Ngrok URL from file (development mode only, for local tunneling)
 *   2. NINJAONE_WEBHOOK_BASE_URL environment variable
 *   3. NEXTAUTH_URL environment variable
 *   4. Default localhost
 */
export function getWebhookBaseUrl(): string {
  // In development mode, check for ngrok URL file first
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          logger.debug('[NinjaOne Webhook] Using ngrok URL from file', { url: ngrokUrl });
          return ngrokUrl;
        }
      }
    } catch (error) {
      // Ignore file read errors, fall back to env vars
      logger.debug('[NinjaOne Webhook] Could not read ngrok URL file, using environment variables');
    }
  }

  // Fall back to environment variables
  return process.env.NINJAONE_WEBHOOK_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

/**
 * Generate a secure webhook secret
 */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Build the webhook callback URL for a tenant
 */
export function buildWebhookUrl(tenantId: string): string {
  // Use query parameter for tenant identification
  // This allows the webhook handler to identify which tenant the event belongs to
  const baseUrl = getWebhookBaseUrl().replace(/\/$/, '');
  return `${baseUrl}/api/webhooks/ninjaone?tenant=${encodeURIComponent(tenantId)}`;
}

/**
 * Create the default webhook configuration for Alga PSA
 */
export function createWebhookConfig(
  tenantId: string,
  webhookSecret: string
): WebhookConfiguration {
  // Based on NinjaOne API, activities should be a map of ActivityType -> status codes
  // For now, we'll subscribe to all activity types by not specifying activities filter
  // This allows us to receive all webhook events and filter them in our handler
  return {
    url: buildWebhookUrl(tenantId),
    // Note: Omitting activities filter to receive all webhook events
    // NinjaOne API expects activities to be a Map<ActivityType, string[]>
    // but we want to receive all events and filter in our handler
    // If needed, we can add specific activity types later:
    // activities: {
    //   "CONDITION": ["TRIGGERED", "RESET"],
    //   "SYSTEM": ["NODE_CREATED", "NODE_UPDATED"],
    //   ...
    // }
    // Expand device and organization references in webhook payloads
    // This gives us more context without additional API calls
    expand: ['device', 'organization'],
    // Add custom auth header for webhook verification
    headers: [
      {
        name: WEBHOOK_AUTH_HEADER,
        value: webhookSecret,
      },
    ],
  };
}

/**
 * Register the webhook with NinjaOne
 *
 * Should be called after successful OAuth authentication.
 * Generates a webhook secret and stores it in the integration settings.
 */
export async function registerNinjaOneWebhook(
  client: NinjaOneClient,
  tenantId: string,
  webhookSecret?: string
): Promise<{ success: boolean; webhookSecret: string; error?: string }> {
  try {
    // Generate new secret if not provided
    const secret = webhookSecret || generateWebhookSecret();

    // Create webhook configuration
    const config = createWebhookConfig(tenantId, secret);

    logger.info('[NinjaOne Webhook] Registering webhook', {
      tenantId,
      url: config.url,
      hasActivitiesFilter: !!config.activities,
    });

    // Register with NinjaOne API
    await client.configureWebhook(config);

    logger.info('[NinjaOne Webhook] Webhook registered successfully', {
      tenantId,
    });

    return {
      success: true,
      webhookSecret: secret,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error('[NinjaOne Webhook] Failed to register webhook', {
      tenantId,
      error: errorMessage,
    });

    return {
      success: false,
      webhookSecret: '',
      error: errorMessage,
    };
  }
}

/**
 * Remove the webhook from NinjaOne
 *
 * Should be called when disconnecting the integration.
 */
export async function removeNinjaOneWebhook(
  client: NinjaOneClient,
  tenantId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[NinjaOne Webhook] Removing webhook', { tenantId });

    await client.removeWebhook();

    logger.info('[NinjaOne Webhook] Webhook removed successfully', { tenantId });

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Log but don't fail if webhook doesn't exist
    // This can happen if webhook was never registered or already removed
    logger.warn('[NinjaOne Webhook] Failed to remove webhook (may not exist)', {
      tenantId,
      error: errorMessage,
    });

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Verify a webhook request using the secret header
 */
export function verifyWebhookRequest(
  headers: Headers | Record<string, string | string[] | undefined>,
  expectedSecret: string
): boolean {
  let receivedSecret: string | null = null;

  if (headers instanceof Headers) {
    receivedSecret = headers.get(WEBHOOK_AUTH_HEADER);
  } else {
    const headerValue = headers[WEBHOOK_AUTH_HEADER] || headers[WEBHOOK_AUTH_HEADER.toLowerCase()];
    receivedSecret = Array.isArray(headerValue) ? headerValue[0] : headerValue || null;
  }

  if (!receivedSecret || !expectedSecret) {
    return false;
  }

  // Use timing-safe comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(receivedSecret),
      Buffer.from(expectedSecret)
    );
  } catch {
    return false;
  }
}

/**
 * Get the webhook auth header name (for documentation/configuration)
 */
export function getWebhookAuthHeaderName(): string {
  return WEBHOOK_AUTH_HEADER;
}
