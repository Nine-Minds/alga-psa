'use server'

import { createTenantKnex } from '../../db';
import { setupPubSub } from './setupPubSub';
import { GmailWebhookService } from '../../../services/email/GmailWebhookService';
import type { GoogleEmailProviderConfig } from '../../../components/EmailProviderConfiguration';

/**
 * Generate standardized Pub/Sub topic and subscription names for a tenant
 */
function generatePubSubNames(tenantId: string) {
  // Use ngrok URL in development if available
  const baseUrl = process.env.NGROK_URL || 
                  process.env.NEXT_PUBLIC_APP_URL || 
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

/**
 * Configure Gmail provider with Pub/Sub and webhook registration.
 * This is the single orchestrator for Gmail provider setup that ensures
 * exactly one Pub/Sub initialization per logical trigger.
 */
export async function configureGmailProvider({
  tenant,
  providerId,
  projectId,
  force = false
}: ConfigureGmailProviderOptions) {
  try {
    // Check if Pub/Sub was already initialized recently (within 24 hours) unless force=true
    if (!force) {
      const knex = createTenantKnex();
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

    // Step 2: Update pubsub_initialised_at timestamp
    const knex = createTenantKnex();
    await knex('google_email_provider_config')
      .where('email_provider_id', providerId)
      .andWhere('tenant', tenant)
      .update({
        pubsub_initialised_at: knex.fn.now()
      });

    // Step 3: Register Gmail watch subscription (webhook only - no Pub/Sub)
    try {
      console.log(`🔗 Registering Gmail watch subscription for provider ${providerId}`);
      
      // Get the provider config for the Gmail webhook service
      const providerConfig = await knex('google_email_provider_config')
        .select('*')
        .where('email_provider_id', providerId)
        .andWhere('tenant', tenant)
        .first() as GoogleEmailProviderConfig;

      if (!providerConfig) {
        throw new Error(`Gmail provider config not found for provider ${providerId}`);
      }

      const gmailWebhookService = new GmailWebhookService();
      
      // Note: This will call the new registerWatch method (not setupGmailWebhook)
      // which only registers the Gmail watch and doesn't touch Pub/Sub
      await gmailWebhookService.registerWatch(providerConfig, {
        projectId,
        topicName: pubsubNames.topicName,
        subscriptionName: pubsubNames.subscriptionName,
        webhookUrl: pubsubNames.webhookUrl
      });
      
      console.log(`✅ Successfully registered Gmail watch subscription for provider ${providerId}`);
    } catch (watchError) {
      console.error(`❌ Failed to register Gmail watch subscription for provider ${providerId}:`, {
        tenant,
        providerId,
        error: watchError instanceof Error ? watchError.message : String(watchError),
        stack: watchError instanceof Error ? watchError.stack : undefined
      });
      // Don't throw error here - provider is still functional without real-time notifications
      // The watch subscription can be manually initialized later
    }
  } catch (pubsubError) {
    console.error(`❌ Failed to configure Gmail provider ${providerId}:`, {
      tenant,
      providerId,
      projectId,
      error: pubsubError instanceof Error ? pubsubError.message : String(pubsubError),
      stack: pubsubError instanceof Error ? pubsubError.stack : undefined
    });
    // Don't throw error here - provider is still functional without Pub/Sub
    // The error will be logged and can be addressed later
  }
}