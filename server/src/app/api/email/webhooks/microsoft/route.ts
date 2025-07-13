import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@shared/db/admin';
import { withTransaction } from '@shared/db';
import { publishEvent } from '@shared/events/publisher';
import { randomBytes } from 'crypto';

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

          // Validate client state
          const vendorConfig = typeof provider.vendor_config === 'string' 
            ? JSON.parse(provider.vendor_config) 
            : provider.vendor_config;

          if (notification.clientState !== vendorConfig.clientState) {
            console.error(`Invalid client state for provider ${provider.id}`);
            return;
          }

          // Extract message ID from resource
          const messageId = notification.resourceData?.id || extractMessageId(notification.resource);
          if (!messageId) {
            console.error('Could not extract message ID from notification');
            return;
          }

          // Publish INBOUND_EMAIL_RECEIVED event
          await publishEvent({
            eventType: 'INBOUND_EMAIL_RECEIVED',
            tenant: provider.tenant,
            payload: {
              providerId: provider.id,
              providerType: 'microsoft',
              mailbox: provider.mailbox,
              messageId: messageId,
              changeType: notification.changeType,
              webhookData: {
                subscriptionId: notification.subscriptionId,
                resource: notification.resource,
                resourceData: notification.resourceData,
                timestamp: new Date().toISOString()
              }
            }
          });

          processedNotifications.push(messageId);
          console.log(`Published event for Microsoft email: ${messageId} from ${provider.mailbox}`);
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
export function generateClientState(): string {
  return randomBytes(32).toString('hex');
}