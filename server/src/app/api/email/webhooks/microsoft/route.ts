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
        // Look up provider by subscription ID via microsoft vendor config (consistent with Google design)
        const row = await trx('microsoft_email_provider_config as mc')
          .join('email_providers as ep', function() {
            this.on('mc.email_provider_id', '=', 'ep.id')
                .andOn('mc.tenant', '=', 'ep.tenant');
          })
          .where('mc.webhook_subscription_id', providerId)
          // Enforce tenant scoping via clientState when available
          .modify((qb: any) => {
            if (notification.clientState) {
              // We use tenant UUID as clientState during subscription creation
              qb.andWhere('mc.tenant', notification.clientState as any);
            }
          })
          .andWhere('ep.provider_type', 'microsoft')
          .first(
            'ep.*',
            trx.raw('mc.client_id as mc_client_id'),
            trx.raw('mc.client_secret as mc_client_secret'),
            trx.raw('mc.tenant_id as mc_tenant_id'),
            trx.raw('mc.access_token as mc_access_token'),
            trx.raw('mc.refresh_token as mc_refresh_token'),
            trx.raw('mc.token_expires_at as mc_token_expires_at'),
            trx.raw('mc.webhook_subscription_id as mc_webhook_subscription_id'),
            trx.raw('mc.webhook_expires_at as mc_webhook_expires_at'),
            trx.raw('mc.webhook_verification_token as mc_webhook_verification_token')
          );

        if (!row) {
          console.error(`Provider not found for subscription: ${providerId}`);
          return;
        }

          // Validate clientState against primary source (email_providers.webhook_verification_token)
          // Validate clientState if present (we set it to our tenant UUID)
          const storedToken = (row as any).mc_webhook_verification_token as string | undefined;
          if (storedToken && notification.clientState && notification.clientState !== storedToken) {
            console.error(`Invalid client state for provider ${row.id}`);
            return;
          }

          // Extract message ID from resource
          const messageId = notification.resourceData?.id || extractMessageId(notification.resource);
          if (!messageId) {
            console.error('Could not extract message ID from notification');
            return;
          }

          // Build provider config to fetch full email details
          // Derive webhook URL from environment (provider row doesn't store it in prod schema)
          const baseUrl = process.env.NGROK_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
          const derivedWebhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;

          const providerConfig: EmailProviderConfig = {
            id: row.id,
            tenant: row.tenant,
            name: row.provider_name || row.mailbox,
            provider_type: 'microsoft',
            mailbox: row.mailbox,
            folder_to_monitor: 'Inbox',
            active: row.is_active,
            webhook_notification_url: (row as any).webhook_notification_url || derivedWebhookUrl,
            webhook_subscription_id: row.mc_webhook_subscription_id,
            webhook_verification_token: (row as any).webhook_verification_token || undefined,
            webhook_expires_at: row.mc_webhook_expires_at,
            connection_status: (row as any).connection_status || row.status || 'connected',
            created_at: row.created_at,
            updated_at: row.updated_at,
            provider_config: {
              client_id: (row as any).mc_client_id,
              client_secret: (row as any).mc_client_secret,
              tenant_id: (row as any).mc_tenant_id,
              access_token: (row as any).mc_access_token,
              refresh_token: (row as any).mc_refresh_token,
              token_expires_at: (row as any).mc_token_expires_at,
            },
          } as any;

          try {
            const adapter = new MicrosoftGraphAdapter(providerConfig);
            await adapter.connect();
            const details = await adapter.getMessageDetails(messageId);
            await publishEvent({
              eventType: 'INBOUND_EMAIL_RECEIVED',
              tenant: row.tenant,
              payload: {
                tenantId: row.tenant,
                tenant: row.tenant,
                providerId: row.id,
                emailData: details,
              },
            });
            processedNotifications.push(messageId);
            console.log(`Published enriched event for Microsoft email: ${messageId} from ${row.mailbox}`);
          } catch (detailErr: any) {
            console.warn(`Failed to fetch/publish Microsoft message ${messageId}: ${detailErr?.message || detailErr}`);
            // Fallback: publish minimal event to acknowledge
            await publishEvent({
              eventType: 'INBOUND_EMAIL_RECEIVED',
              tenant: row.tenant,
              payload: {
                tenantId: row.tenant,
                tenant: row.tenant,
                providerId: row.id,
                emailData: {
                  id: messageId,
                  provider: 'microsoft',
                  providerId: row.id,
                  tenant: row.tenant,
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
