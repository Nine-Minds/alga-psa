import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { withTransaction } from '@alga-psa/shared/db';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import { randomBytes } from 'crypto';
import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

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

// Handle GET for Microsoft validation handshake
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const validationToken = url.searchParams.get('validationtoken') || url.searchParams.get('validationToken');
    if (validationToken) {
      console.log('Microsoft webhook validation (GET) received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    // If no token, just acknowledge
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('Microsoft webhook GET handler error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Handle subscription validation
    // Microsoft may send validation either via querystring (GET) or header on POST in some flows/tests
    const url = request.nextUrl;
    const validationToken =
      request.headers.get('validationtoken') ||
      request.headers.get('ValidationToken') ||
      url.searchParams.get('validationtoken') ||
      url.searchParams.get('validationToken');
    if (validationToken) {
      console.log('Microsoft webhook validation (POST) received (header/query)');
      return new NextResponse(validationToken, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain'
        }
      });
    }

    // Parse webhook payload
    // Be robust to empty or non-JSON bodies during validation probes
    let payload: MicrosoftWebhookPayload | undefined;
    try {
      const raw = await request.text();
      if (!raw) {
        // Empty body — acknowledge to avoid parse crashes during validation probes
        console.log('Microsoft webhook POST received with empty body (likely validation probe)');
        return new NextResponse('OK', { status: 200 });
      }
      payload = JSON.parse(raw);
    } catch (parseErr) {
      // Non-JSON — acknowledge to avoid 500s during validation probes
      console.warn('Microsoft webhook POST with non-JSON body:', parseErr);
      return new NextResponse('OK', { status: 200 });
    }
    if (!payload) {
      console.log('Microsoft webhook POST received with null payload');
      return new NextResponse('OK', { status: 200 });
    }
    console.log('✅ Microsoft webhook notification received:', {
      notificationCount: payload.value?.length || 0,
      timestamp: new Date().toISOString(),
      firstNotification: payload.value?.[0] ? {
        subscriptionId: payload.value[0].subscriptionId,
        changeType: payload.value[0].changeType,
        resourceType: payload.value[0].resourceData?.['@odata.type'],
      } : null,
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
        console.log(`🔍 Processing notification for subscription: ${providerId}`);

        await withTransaction(knex, async (trx) => {
        // Look up provider by subscription ID via microsoft vendor config (consistent with Google design)
        const row = await trx('microsoft_email_provider_config as mc')
          .join('email_providers as ep', function() {
            this.on('mc.email_provider_id', '=', 'ep.id')
                .andOn('mc.tenant', '=', 'ep.tenant');
          })
          .where('mc.webhook_subscription_id', providerId)
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
            trx.raw('mc.webhook_verification_token as mc_webhook_verification_token'),
            trx.raw('mc.folder_filters as mc_folder_filters')
          );

        if (!row) {
          console.error(`❌ Provider not found for subscription: ${providerId}`);
          console.error('This subscription may not exist in the database. Check:');
          console.error(`  1. Is webhook_subscription_id="${providerId}" in microsoft_email_provider_config?`);
          console.error(`  2. Has the email_provider been created?`);
          return;
        }

        console.log(`✅ Found provider for subscription ${providerId}:`, {
          providerId: row.id,
          mailbox: row.mailbox,
          tenant: row.tenant,
        });

          // Validate clientState against stored verification token if present
          // Note: MicrosoftGraphAdapter sets clientState to webhook_verification_token (not tenant ID)
          const storedToken = (row as any).mc_webhook_verification_token as string | undefined;
          if (storedToken) {
            if (!notification.clientState) {
              console.error(`❌ Missing clientState for provider ${row.id}`);
              return;
            }
            if (notification.clientState !== storedToken) {
              console.error(`❌ Invalid client state for provider ${row.id}`);
              console.error(`  Expected: ${storedToken.substring(0, 8)}...(${storedToken.length} chars)`);
              console.error(`  Received: ${notification.clientState.substring(0, 8)}...(${notification.clientState.length} chars)`);
              return;
            }
            console.log(`✅ Client state validation passed for provider ${row.id}`);
          } else {
            console.warn(`⚠️ No stored verification token for provider ${row.id} - skipping client state validation`);
          }

          // Extract message ID from resource
          const messageId = notification.resourceData?.id || extractMessageId(notification.resource);
          if (!messageId) {
            console.error('Could not extract message ID from notification');
            return;
          }

          // Check if this email has already been processed (deduplication)
          // Microsoft may send duplicate webhook notifications for reliability
          const existingProcessed = await trx('email_processed_messages')
            .where({ message_id: messageId, tenant: row.tenant })
            .first();

          if (existingProcessed) {
            console.log(`⚠️ Email ${messageId} already processed (status: ${existingProcessed.processing_status}), skipping duplicate webhook`);
            return;
          }

          // Insert processing record BEFORE publishing event to prevent race conditions
          // This ensures that if Microsoft sends duplicate webhooks simultaneously,
          // only one will proceed past this point
          try {
            await trx('email_processed_messages').insert({
              message_id: messageId,
              provider_id: row.id,
              tenant: row.tenant,
              processed_at: new Date(),
              processing_status: 'processing',
              from_email: null, // Will be updated after fetching details
              subject: notification.resourceData?.subject || null,
              received_at: null,
              attachment_count: 0,
              metadata: JSON.stringify({
                subscriptionId: notification.subscriptionId,
                changeType: notification.changeType,
                webhookReceivedAt: new Date().toISOString(),
              }),
            });
          } catch (insertErr: any) {
            // If insert fails due to unique constraint, another webhook is processing this email
            if (insertErr.code === '23505' || insertErr.message?.includes('duplicate') || insertErr.message?.includes('unique')) {
              console.log(`⚠️ Email ${messageId} is being processed by another webhook, skipping`);
              return;
            }
            throw insertErr;
          }

          // Build provider config to fetch full email details
          // Derive webhook URL from environment (provider row doesn't store it in prod schema)
          const baseUrl = process.env.NGROK_URL || process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXTAUTH_URL || 'http://localhost:3000';
          const derivedWebhookUrl = `${baseUrl}/api/email/webhooks/microsoft`;

          // Determine folder to monitor from saved config (first folder if multiple)
          const ff = (row as any).mc_folder_filters;
          const folderToMonitor = Array.isArray(ff)
            ? (ff[0] || 'Inbox')
            : (() => { try { const parsed = JSON.parse(ff || '[]'); return parsed[0] || 'Inbox'; } catch { return 'Inbox'; } })();

          const providerConfig: EmailProviderConfig = {
            id: row.id,
            tenant: row.tenant,
            name: row.provider_name || row.mailbox,
            provider_type: 'microsoft',
            mailbox: row.mailbox,
            folder_to_monitor: folderToMonitor,
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

            // Update last_sync_at after successful email processing
            await trx('email_providers')
              .where('id', row.id)
              .update({
                last_sync_at: trx.fn.now(),
                updated_at: trx.fn.now()
              });

            // Update processing record with success status and email details
            await trx('email_processed_messages')
              .where({ message_id: messageId, provider_id: row.id, tenant: row.tenant })
              .update({
                processing_status: 'success',
                from_email: details?.from?.email || null,
                subject: details?.subject || notification.resourceData?.subject || null,
                received_at: details?.receivedAt ? new Date(details.receivedAt) : null,
                attachment_count: details?.attachments?.length || 0,
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

            // Update processing record - still mark as partial since event was published
            // (partial success - event published but with minimal data)
            await trx('email_processed_messages')
              .where({ message_id: messageId, provider_id: row.id, tenant: row.tenant })
              .update({
                processing_status: 'partial',
                error_message: detailErr?.message || 'Failed to fetch full email details',
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
