'use server'

import { createTenantKnex, runWithTenant } from '@alga-psa/db';
import { setupPubSub } from './setupPubSub';
import { GmailWebhookService } from '../../services/email/GmailWebhookService';
import type { GoogleEmailProviderConfig } from '../../components/email/types';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const baseUrl = process.env.NGROK_URL || 
                  process.env.NEXT_PUBLIC_BASE_URL || 
                  process.env.NEXTAUTH_URL ||
                  'http://localhost:3000';
  
  return {
    topicName: `gmail-notifications-${tenantId}`,
    subscriptionName: `gmail-webhook-${tenantId}`,
    webhookUrl: `${baseUrl}/api/email/webhooks/google`
  };
}

interface ConfigureGmailProviderOptions {
  tenant: string;
  providerId: string;
  projectId: string;
  force?: boolean;
}

export interface ConfigureGmailProviderResult {
  success: boolean;
  pubsubConfigured: boolean;
  watchRegistered: boolean;
  error?: string;
  warnings: string[];
}

/**
 * Configure Gmail provider with Pub/Sub and webhook registration.
 * This is the single orchestrator for Gmail provider setup that ensures
 * exactly one Pub/Sub initialization per logical trigger.
 *
 * Returns a result object indicating what succeeded/failed so the UI can inform the user.
 */
export async function configureGmailProvider({
  tenant,
  providerId,
  projectId,
  force = false
}: ConfigureGmailProviderOptions): Promise<ConfigureGmailProviderResult> {
  const result: ConfigureGmailProviderResult = {
    success: false,
    pubsubConfigured: false,
    watchRegistered: false,
    warnings: []
  };

  if (tenant == null || !tenant || !providerId || !projectId) {
    result.error = 'Missing required parameters: tenant, providerId, and projectId are required';
    return result;
  }

  try {
    await runWithTenant(tenant, async () => {
      // Check if Pub/Sub was already initialized recently (within 24 hours) unless force=true
      if (!force) {
        const {knex} = await createTenantKnex();
        const config = await knex('google_email_provider_config')
          .select('pubsub_initialised_at')
          .where('email_provider_id', providerId)
          .andWhere('tenant', tenant)
          .first() as GoogleEmailProviderConfig | undefined;

        if (config?.pubsub_initialised_at) {
          const initialisedAt = new Date(config.pubsub_initialised_at);
          const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
          
          if (initialisedAt > twentyFourHoursAgo) {
            console.log(`⏭️ Skipping Pub/Sub setup for Gmail provider ${providerId} - already initialized within 24 hours`, {
              tenant,
              providerId,
              pubsub_initialised_at: config.pubsub_initialised_at
            });
            result.success = true;
            result.pubsubConfigured = true;
            result.watchRegistered = true;
            return;
          }
        }
      }

      const pubsubNames = generatePubSubNames(tenant);
      console.log(`🔧 Configuring Gmail provider ${providerId} with Pub/Sub:`, {
        tenant,
        providerId,
        projectId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName,
        webhookUrl: pubsubNames.webhookUrl,
        force
      });
      
      // Step 1: Set up Pub/Sub topic and subscription
      await setupPubSub({
        tenantId: tenant,
        projectId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName,
        webhookUrl: pubsubNames.webhookUrl
      });
      
      console.log(`✅ Successfully set up Pub/Sub for Gmail provider ${providerId}:`, {
        tenant,
        providerId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName
      });
      result.pubsubConfigured = true;

      // Step 2: Update pubsub_initialised_at timestamp
      const { knex } = await createTenantKnex();
      await knex('google_email_provider_config')
        .where('email_provider_id', providerId)
        .andWhere('tenant', tenant)
        .update({
          pubsub_initialised_at: knex.fn.now()
        });

      // Step 3: Register Gmail watch subscription (webhook only - no Pub/Sub)
      try {
        console.log(`🔗 Registering Gmail watch subscription for provider ${providerId}`);
        
        // Get both the base provider and Google-specific config
        const baseProvider = await knex('email_providers')
          .select('*')
          .where('id', providerId)
          .andWhere('tenant', tenant)
          .first();

        const googleConfig = await knex('google_email_provider_config')
          .select('*')
          .where('email_provider_id', providerId)
          .andWhere('tenant', tenant)
          .first() as GoogleEmailProviderConfig;

        if (!baseProvider || !googleConfig) {
          throw new Error(`Gmail provider or config not found for provider ${providerId}`);
        }

        // Guard: only attempt watch registration if tokens exist
        if (!googleConfig.access_token || !googleConfig.refresh_token) {
          console.log(`⏭️ Skipping Gmail watch registration for provider ${providerId}: OAuth tokens missing`, {
            tenant,
            hasAccessToken: !!googleConfig.access_token,
            hasRefreshToken: !!googleConfig.refresh_token
          });
          result.warnings.push('OAuth tokens missing - Gmail watch registration skipped');
          result.success = result.pubsubConfigured; // Still considered success if pubsub was configured
          return;
        }

        // Create EmailProviderConfig for the GmailWebhookService
        const emailProviderConfig: EmailProviderConfig = {
          id: baseProvider.id,
          tenant: baseProvider.tenant,
          name: baseProvider.provider_name,
          provider_type: baseProvider.provider_type as 'google',
          mailbox: baseProvider.mailbox,
          folder_to_monitor: 'Inbox',
          active: baseProvider.is_active,
          webhook_notification_url: pubsubNames.webhookUrl,
          connection_status: baseProvider.status || 'disconnected',
          created_at: baseProvider.created_at,
          updated_at: baseProvider.updated_at,
          provider_config: {
            project_id: googleConfig.project_id ?? undefined,
            pubsub_topic_name: pubsubNames.topicName,
            pubsub_subscription_name: pubsubNames.subscriptionName,
            client_id: googleConfig.client_id || undefined,
            label_filters: Array.isArray((googleConfig as any).label_filters)
              ? (googleConfig as any).label_filters
              : (() => {
                  try {
                    const parsed = JSON.parse((googleConfig as any).label_filters || '[]');
                    return Array.isArray(parsed) ? parsed : [];
                  } catch {
                    return [];
                  }
                })(),
            access_token: googleConfig.access_token || undefined,
            refresh_token: googleConfig.refresh_token || undefined,
            token_expires_at: googleConfig.token_expires_at || undefined,
            history_id: googleConfig.history_id || undefined,
            watch_expiration: googleConfig.watch_expiration || undefined
          }
        };

        const gmailWebhookService = new GmailWebhookService();
        
        // Register the Gmail watch
        await gmailWebhookService.registerWatch(emailProviderConfig, {
          projectId,
          topicName: pubsubNames.topicName,
          subscriptionName: pubsubNames.subscriptionName,
          webhookUrl: pubsubNames.webhookUrl
        });
        
        // Update the main provider's last_sync_at to reflect successful configuration
        await knex('email_providers')
          .where('id', providerId)
          .andWhere('tenant', tenant)
          .update({
            last_sync_at: knex.fn.now(),
            updated_at: knex.fn.now()
          });

        console.log(`✅ Successfully registered Gmail watch subscription for provider ${providerId}`);
        result.watchRegistered = true;
        result.success = true;
      } catch (watchError) {
        const errorMessage = watchError instanceof Error ? watchError.message : String(watchError);
        console.error(`❌ Failed to register Gmail watch subscription for provider ${providerId}:`, {
          tenant,
          providerId,
          error: errorMessage,
          stack: watchError instanceof Error ? watchError.stack : undefined
        });
        // Record the error but don't throw - provider is saved, Pub/Sub may still work
        result.warnings.push(`Failed to register Gmail watch: ${errorMessage}`);
        // If Pub/Sub was configured, we're partially successful
        result.success = result.pubsubConfigured;
      }
    });
  } catch (pubsubError) {
    const errorMessage = pubsubError instanceof Error ? pubsubError.message : String(pubsubError);
    console.error(`❌ Failed to configure Gmail provider ${providerId}:`, {
      tenant,
      providerId,
      projectId,
      error: errorMessage,
      stack: pubsubError instanceof Error ? pubsubError.stack : undefined
    });
    // This is a critical failure - Pub/Sub setup failed
    result.error = `Failed to configure Gmail Pub/Sub: ${errorMessage}`;
    result.success = false;
  }

  return result;
}
