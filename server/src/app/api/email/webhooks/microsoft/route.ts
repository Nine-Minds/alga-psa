import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/shared/db/admin.js';
import { withTransaction } from '@alga-psa/shared/db';
import { publishEvent } from '@alga-psa/shared/events/publisher.js';
import { randomBytes } from 'crypto';
import { MicrosoftGraphAdapter } from '@/services/email/providers/MicrosoftGraphAdapter';
import type { EmailProviderConfig } from '@/interfaces/email.interfaces';

interface MicrosoftNotification {
  changeType: string;
  clientState: string;
  resource: string;
  resourceData: {
    '@odata.type': string;
    '@odata.id': string;
    id: string;
    subject?: string;
  };
  subscriptionExpirationDateTime: string;
  subscriptionId: string;
  tenantId: string;
}

interface MicrosoftWebhookPayload {
  value: MicrosoftNotification[];
}

export async function POST(request: NextRequest) {
  try {
    // Handle subscription validation
    const validationToken = request.headers.get('validationtoken');
    if (validationToken) {
      console.log('Microsoft webhook validation request received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
    }

    // Parse webhook payload
    const payload: MicrosoftWebhookPayload = await request.json();
    console.log('Microsoft webhook notification received:', {
      notificationCount: payload.value?.length || 0,
      timestamp: new Date().toISOString()
    });

    if (!payload.value || payload.value.length === 0) {
      return NextResponse.json({ success: true, message: 'No notifications to process' });
    }

    const knex = await getAdminConnection();
    const processedNotifications: string[] = [];

    // Process each notification
    for (const notification of payload.value) {
      try {
        // Validate client state
        const providerId = notification.subscriptionId;
        
        await withTransaction(knex, async (trx) => {
          // Look up provider by subscription ID
          const provider = await trx('email_providers')
            .where('webhook_id', providerId)
            .where('provider_type', 'microsoft')
            .first();

          if (!provider) {
            console.error(`Provider not found for subscription: ${providerId}`);
            return;
          }

          // Validate clientState against primary source (email_providers.webhook_verification_token)
          const webhookToken = provider.webhook_verification_token;
          if (webhookToken && notification.clientState !== webhookToken) {
            console.error(`Invalid client state for provider ${provider.id}`);
            return;
          }

          // Extract message ID from resource
          const messageId = notification.resourceData?.id || extractMessageId(notification.resource);
          if (!messageId) {
            console.error('Could not extract message ID from notification');
            return;
          }

          // Build provider config to fetch full email details
          const msConfig = await trx('microsoft_email_provider_config')
            .where('email_provider_id', provider.id)
            .first();

          const providerConfig: EmailProviderConfig = {
            id: provider.id,
            tenant: provider.tenant,
            name: provider.provider_name || provider.mailbox,
            provider_type: 'microsoft',
            mailbox: provider.mailbox,
            folder_to_monitor: 'Inbox',
            active: provider.is_active,
            webhook_notification_url: provider.webhook_notification_url,
            webhook_subscription_id: provider.webhook_subscription_id,
            webhook_verification_token: provider.webhook_verification_token,
            webhook_expires_at: provider.webhook_expires_at,
            connection_status: provider.connection_status || provider.status || 'connected',
            created_at: provider.created_at,
            updated_at: provider.updated_at,
            provider_config: msConfig ? {
              client_id: msConfig.client_id,
              client_secret: msConfig.client_secret,
              tenant_id: msConfig.tenant_id,
              access_token: msConfig.access_token,
              refresh_token: msConfig.refresh_token,
              token_expires_at: msConfig.token_expires_at,
            } : {},
          } as any;

          try {
            const adapter = new MicrosoftGraphAdapter(providerConfig);
            await adapter.connect();
            const details = await adapter.getMessageDetails(messageId);
            await publishEvent({
              eventType: 'INBOUND_EMAIL_RECEIVED',
              tenant: provider.tenant,
              payload: {
                tenantId: provider.tenant,
                tenant: provider.tenant,
                providerId: provider.id,
                emailData: details,
              },
            });
            processedNotifications.push(messageId);
            console.log(`Published enriched event for Microsoft email: ${messageId} from ${provider.mailbox}`);
          } catch (detailErr: any) {
            console.warn(`Failed to fetch/publish Microsoft message ${messageId}: ${detailErr?.message || detailErr}`);
            // Fallback: publish minimal event to acknowledge
            await publishEvent({
              eventType: 'INBOUND_EMAIL_RECEIVED',
              tenant: provider.tenant,
              payload: {
                tenantId: provider.tenant,
                tenant: provider.tenant,
                providerId: provider.id,
                emailData: {
                  id: messageId,
                  provider: 'microsoft',
                  providerId: provider.id,
                  tenant: provider.tenant,
                  receivedAt: new Date().toISOString(),
                  from: { email: '', name: undefined },
                  to: [],
                  subject: notification.resourceData?.subject || '',
                  body: { text: '', html: undefined },
                } as any,
              },
            });
            processedNotifications.push(messageId);
          }
        });
      } catch (error) {
        console.error('Error processing Microsoft notification:', error);
        // Continue processing other notifications
      }
    }

    return NextResponse.json({ 
      success: true, 
      processedCount: processedNotifications.length,
      messageIds: processedNotifications
    });

  } catch (error: any) {
    console.error('Microsoft webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Handle OPTIONS for CORS
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Extract message ID from resource URL
function extractMessageId(resource: string): string | null {
  // Resource format: /users/{userId}/messages/{messageId}
  const match = resource.match(/\/messages\/([^\/]+)/);
  return match ? match[1] : null;
}

// Generate client state for webhook validation
function generateClientState(): string {
  return randomBytes(32).toString('hex');
}
