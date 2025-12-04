'use server';

/**
 * Payment Configuration Actions
 *
 * Server actions for managing payment provider configuration.
 * These actions allow tenants to connect payment providers,
 * configure settings, and manage payment integrations.
 */

import { getConnection } from 'server/src/lib/db/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { getSecretProviderInstance } from '@alga-psa/shared/core';
import logger from '@alga-psa/shared/core/logger';
import Stripe from 'stripe';
import * as fs from 'fs';
import {
  IPaymentProviderConfig,
  PaymentSettings,
  DEFAULT_PAYMENT_SETTINGS,
} from 'server/src/interfaces/payment.interfaces';

// Path to ngrok URL file (written by ngrok-sync container)
const NGROK_URL_FILE = '/app/ngrok/url';

// Check if running in development mode
const isDevelopment = process.env.NODE_ENV === 'development' || process.env.APP_ENV === 'development';

/**
 * Gets the base URL for Stripe webhooks.
 * Priority:
 * 1. Explicit STRIPE_WEBHOOK_BASE_URL override
 * 2. ngrok URL file in development mode
 * 3. NEXT_PUBLIC_APP_URL / NEXTAUTH_URL / APP_BASE_URL fallback
 */
const getStripeBaseUrl = (): string => {
  // If explicitly set, use that
  if (process.env.STRIPE_WEBHOOK_BASE_URL) {
    return process.env.STRIPE_WEBHOOK_BASE_URL;
  }

  // In development mode, check for ngrok URL file first
  if (isDevelopment) {
    try {
      if (fs.existsSync(NGROK_URL_FILE)) {
        const ngrokUrl = fs.readFileSync(NGROK_URL_FILE, 'utf-8').trim();
        if (ngrokUrl) {
          console.log(`[PaymentActions] Using ngrok URL for Stripe webhook: ${ngrokUrl}`);
          return ngrokUrl;
        }
      }
    } catch (error) {
      // Ignore file read errors, fall back to env vars
      console.debug('[PaymentActions] Could not read ngrok URL file, using environment variables');
    }
  }

  // Fall back to environment variables
  return process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.APP_BASE_URL || 'http://localhost:3000';
};

/**
 * Result of a payment action.
 */
interface PaymentActionResult<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Stripe connection credentials from user input.
 */
interface StripeCredentials {
  secretKey: string;
  publishableKey: string;
}

/**
 * Events we subscribe to for invoice payment processing.
 * These are automatically configured when connecting Stripe.
 */
const STRIPE_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
];

/**
 * Payment provider configuration for display.
 */
interface PaymentProviderDisplay {
  provider_type: string;
  is_enabled: boolean;
  is_default: boolean;
  settings: PaymentSettings;
  created_at: string;
  updated_at: string;
  publishable_key?: string; // Safe to display
  has_webhook_secret: boolean;
  webhook_url?: string;
  webhook_events?: string[];
  webhook_status?: 'enabled' | 'disabled' | 'not_configured';
}

/**
 * Gets the current payment provider configuration for the tenant.
 */
export async function getPaymentConfigAction(): Promise<PaymentActionResult<PaymentProviderDisplay | null>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const knex = await getConnection();
    const config = await knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
      })
      .first();

    if (!config) {
      return { success: true, data: null };
    }

    // Get webhook URL for display
    const baseUrl = getStripeBaseUrl();
    const webhookUrl = `${baseUrl}/api/webhooks/stripe/payments`;

    // Determine webhook status
    const configuration = config.configuration as any;
    let webhookStatus: 'enabled' | 'disabled' | 'not_configured' = 'not_configured';
    if (configuration?.webhook_endpoint_id && config.webhook_secret_vault_path) {
      webhookStatus = 'enabled';
    }

    // Build display config (hide sensitive data)
    const displayConfig: PaymentProviderDisplay = {
      provider_type: config.provider_type,
      is_enabled: config.is_enabled,
      is_default: config.is_default,
      settings: {
        ...DEFAULT_PAYMENT_SETTINGS,
        ...(config.settings as Partial<PaymentSettings>),
      },
      created_at: config.created_at,
      updated_at: config.updated_at,
      publishable_key: configuration?.publishable_key,
      has_webhook_secret: !!config.webhook_secret_vault_path,
      webhook_url: webhookUrl,
      webhook_events: STRIPE_WEBHOOK_EVENTS as string[],
      webhook_status: webhookStatus,
    };

    return { success: true, data: displayConfig };
  } catch (error) {
    logger.error('[PaymentActions] Failed to get payment config', { error });
    return { success: false, error: 'Failed to get payment configuration' };
  }
}

/**
 * Connects a Stripe account to the tenant.
 * Validates the credentials, creates webhook endpoint automatically, and stores configuration.
 */
export async function connectStripeAction(
  credentials: StripeCredentials
): Promise<PaymentActionResult<{ publishableKey: string; webhookConfigured: boolean }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    // Validate credentials by making a test API call
    const stripe = new Stripe(credentials.secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
    });

    try {
      // Test the API key by fetching account info
      await stripe.accounts.retrieve();
    } catch (stripeError: any) {
      if (stripeError.type === 'StripeAuthenticationError') {
        return { success: false, error: 'Invalid Stripe secret key' };
      }
      throw stripeError;
    }

    // Validate publishable key format
    if (!credentials.publishableKey.startsWith('pk_')) {
      return { success: false, error: 'Invalid publishable key format (should start with pk_)' };
    }

    // Store credentials securely
    const secretProvider = await getSecretProviderInstance();
    await secretProvider.setTenantSecret(
      user.tenant,
      'stripe_payment_secret_key',
      credentials.secretKey
    );

    // Get the webhook URL
    const baseUrl = getStripeBaseUrl();
    const webhookUrl = `${baseUrl}/api/webhooks/stripe/payments`;

    // Check for existing webhook endpoints to avoid duplicates
    let webhookEndpointId: string | null = null;
    let webhookSecret: string | null = null;
    let webhookConfigured = false;

    try {
      // List existing webhooks to check for duplicates
      const existingWebhooks = await stripe.webhookEndpoints.list({ limit: 100 });
      const existingEndpoint = existingWebhooks.data.find(
        (endpoint) => endpoint.url === webhookUrl
      );

      if (existingEndpoint) {
        // Webhook already exists - update it with correct events
        logger.info('[PaymentActions] Found existing webhook endpoint, updating events', {
          endpointId: existingEndpoint.id,
          tenantId: user.tenant,
        });

        await stripe.webhookEndpoints.update(existingEndpoint.id, {
          enabled_events: STRIPE_WEBHOOK_EVENTS,
          description: `Alga PSA payment webhook for tenant ${user.tenant}`,
        });

        webhookEndpointId = existingEndpoint.id;
        // Note: We can't retrieve the secret for an existing webhook
        // User would need to delete and recreate if secret is lost
        webhookConfigured = true;
      } else {
        // Create new webhook endpoint
        logger.info('[PaymentActions] Creating new Stripe webhook endpoint', {
          webhookUrl,
          tenantId: user.tenant,
        });

        const webhookEndpoint = await stripe.webhookEndpoints.create({
          url: webhookUrl,
          enabled_events: STRIPE_WEBHOOK_EVENTS,
          description: `Alga PSA payment webhook for tenant ${user.tenant}`,
          metadata: {
            tenant_id: user.tenant,
            created_by: 'alga-psa',
          },
        });

        webhookEndpointId = webhookEndpoint.id;
        webhookSecret = webhookEndpoint.secret || null;
        webhookConfigured = true;

        // Store the webhook secret
        if (webhookSecret) {
          await secretProvider.setTenantSecret(
            user.tenant,
            'stripe_payment_webhook_secret',
            webhookSecret
          );
        }

        logger.info('[PaymentActions] Webhook endpoint created successfully', {
          endpointId: webhookEndpointId,
          tenantId: user.tenant,
        });
      }
    } catch (webhookError: any) {
      // Log webhook creation failure but don't fail the connection
      // User can still use Stripe, just without automatic webhook processing
      logger.warn('[PaymentActions] Failed to create webhook endpoint', {
        error: webhookError.message,
        tenantId: user.tenant,
        webhookUrl,
      });
      // webhookConfigured remains false
    }

    // Create or update provider config
    const knex = await getConnection();
    const existingConfig = await knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
      })
      .first();

    const configData = {
      is_enabled: true,
      is_default: true,
      configuration: {
        publishable_key: credentials.publishableKey,
        webhook_endpoint_id: webhookEndpointId,
      },
      credentials_vault_path: `tenant/${user.tenant}/stripe_payment_secret_key`,
      webhook_secret_vault_path: webhookSecret
        ? `tenant/${user.tenant}/stripe_payment_webhook_secret`
        : (existingConfig?.webhook_secret_vault_path || null),
      settings: DEFAULT_PAYMENT_SETTINGS,
      updated_at: knex.fn.now(),
    };

    if (existingConfig) {
      await knex('payment_provider_configs')
        .where({ config_id: existingConfig.config_id })
        .update(configData);
    } else {
      await knex('payment_provider_configs').insert({
        tenant: user.tenant,
        provider_type: 'stripe',
        ...configData,
      });
    }

    logger.info('[PaymentActions] Stripe connected successfully', {
      tenantId: user.tenant,
      userId: user.user_id,
      webhookConfigured,
    });

    return {
      success: true,
      data: { publishableKey: credentials.publishableKey, webhookConfigured },
    };
  } catch (error) {
    logger.error('[PaymentActions] Failed to connect Stripe', { error });
    return { success: false, error: 'Failed to connect Stripe account' };
  }
}

/**
 * Disconnects the Stripe account from the tenant.
 * Also deletes the webhook endpoint from Stripe.
 */
export async function disconnectStripeAction(): Promise<PaymentActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const knex = await getConnection();
    const secretProvider = await getSecretProviderInstance();

    // Get current config to find webhook endpoint ID
    const config = await knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
      })
      .first();

    // Try to delete the webhook endpoint from Stripe
    if (config) {
      const configuration = config.configuration as any;
      const webhookEndpointId = configuration?.webhook_endpoint_id;

      if (webhookEndpointId) {
        try {
          const secretKey = await secretProvider.getTenantSecret(
            user.tenant,
            'stripe_payment_secret_key'
          );

          if (secretKey) {
            const stripe = new Stripe(secretKey, {
              apiVersion: '2024-12-18.acacia' as any,
            });

            await stripe.webhookEndpoints.del(webhookEndpointId);
            logger.info('[PaymentActions] Deleted Stripe webhook endpoint', {
              endpointId: webhookEndpointId,
              tenantId: user.tenant,
            });
          }
        } catch (webhookError: any) {
          // Log but don't fail - webhook might already be deleted
          logger.warn('[PaymentActions] Failed to delete webhook endpoint', {
            error: webhookError.message,
            endpointId: webhookEndpointId,
            tenantId: user.tenant,
          });
        }
      }
    }

    // Disable the provider config and clear webhook info
    await knex('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
      })
      .update({
        is_enabled: false,
        configuration: knex.raw("configuration - 'webhook_endpoint_id'"),
        webhook_secret_vault_path: null,
        updated_at: knex.fn.now(),
      });

    // Delete the webhook secret from vault
    try {
      await secretProvider.deleteTenantSecret(user.tenant, 'stripe_payment_webhook_secret');
    } catch {
      // Ignore if secret doesn't exist
    }

    logger.info('[PaymentActions] Stripe disconnected', {
      tenantId: user.tenant,
      userId: user.user_id,
    });

    return { success: true };
  } catch (error) {
    logger.error('[PaymentActions] Failed to disconnect Stripe', { error });
    return { success: false, error: 'Failed to disconnect Stripe account' };
  }
}

/**
 * Updates payment settings for the tenant.
 */
export async function updatePaymentSettingsAction(
  settings: Partial<PaymentSettings>
): Promise<PaymentActionResult<PaymentSettings>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const knex = await getConnection();

    // Get current config
    const config = await knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
      })
      .first();

    if (!config) {
      return { success: false, error: 'No payment provider configured' };
    }

    // Merge settings
    const currentSettings = config.settings as Partial<PaymentSettings> || {};
    const newSettings: PaymentSettings = {
      ...DEFAULT_PAYMENT_SETTINGS,
      ...currentSettings,
      ...settings,
    };

    // Update config
    await knex('payment_provider_configs')
      .where({ config_id: config.config_id })
      .update({
        settings: newSettings,
        updated_at: knex.fn.now(),
      });

    logger.info('[PaymentActions] Payment settings updated', {
      tenantId: user.tenant,
      userId: user.user_id,
      settings: newSettings,
    });

    return { success: true, data: newSettings };
  } catch (error) {
    logger.error('[PaymentActions] Failed to update payment settings', { error });
    return { success: false, error: 'Failed to update payment settings' };
  }
}

/**
 * Tests the Stripe connection by making a simple API call.
 */
export async function testStripeConnectionAction(): Promise<PaymentActionResult<{ status: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const secretProvider = await getSecretProviderInstance();
    const secretKey = await secretProvider.getTenantSecret(user.tenant, 'stripe_payment_secret_key');

    if (!secretKey) {
      return { success: false, error: 'Stripe not configured' };
    }

    const stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia' as any,
    });

    // Test by fetching account info
    const account = await stripe.accounts.retrieve();

    return {
      success: true,
      data: {
        status: `Connected to Stripe account: ${account.id}`,
      },
    };
  } catch (error: any) {
    logger.error('[PaymentActions] Stripe connection test failed', { error });

    if (error.type === 'StripeAuthenticationError') {
      return { success: false, error: 'Invalid API key - please reconnect' };
    }

    return { success: false, error: 'Connection test failed' };
  }
}

/**
 * Gets the webhook URL for Stripe configuration.
 * Uses ngrok URL in development mode if available, with explicit override support.
 */
export async function getStripeWebhookUrlAction(): Promise<PaymentActionResult<{ webhookUrl: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const baseUrl = getStripeBaseUrl();
    const webhookUrl = `${baseUrl}/api/webhooks/stripe/payments`;

    console.log('[PaymentActions] Generated Stripe webhook URL:', webhookUrl);

    return { success: true, data: { webhookUrl } };
  } catch (error) {
    logger.error('[PaymentActions] Failed to get webhook URL', { error });
    return { success: false, error: 'Failed to get webhook URL' };
  }
}

/**
 * Gets the Stripe publishable key for client-side initialization.
 */
export async function getStripePublishableKeyAction(): Promise<PaymentActionResult<{ publishableKey: string }>> {
  try {
    const user = await getCurrentUser();
    if (!user?.tenant) {
      return { success: false, error: 'Unauthorized' };
    }

    const knex = await getConnection();
    const config = await knex<IPaymentProviderConfig>('payment_provider_configs')
      .where({
        tenant: user.tenant,
        provider_type: 'stripe',
        is_enabled: true,
      })
      .first();

    if (!config) {
      return { success: false, error: 'Stripe not configured' };
    }

    const publishableKey = (config.configuration as any)?.publishable_key;
    if (!publishableKey) {
      return { success: false, error: 'Publishable key not found' };
    }

    return { success: true, data: { publishableKey } };
  } catch (error) {
    logger.error('[PaymentActions] Failed to get publishable key', { error });
    return { success: false, error: 'Failed to get publishable key' };
  }
}
