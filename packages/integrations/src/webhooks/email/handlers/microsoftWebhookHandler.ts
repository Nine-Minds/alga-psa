import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/db/admin';
import { withTransaction } from '@alga-psa/db';
import { enqueueUnifiedInboundEmailQueueJob } from '@alga-psa/shared/services/email/unifiedInboundEmailQueue';

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

async function assertTenantEmailProductAccess(trx: any, tenantId: string): Promise<void> {
  const tenant = await trx('tenants').where({ tenant: tenantId }).first('product_code');
  const productCode = typeof tenant?.product_code === 'string' ? tenant.product_code : 'psa';
  if (productCode !== 'psa' && productCode !== 'algadesk') {
    throw new Error(`Product access denied for tenant ${tenantId}`);
  }
}

// Handle GET for Microsoft validation handshake
export async function handleMicrosoftWebhookGet(request: NextRequest) {
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

export async function handleMicrosoftWebhookPost(request: NextRequest) {
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
    let unifiedQueuedCount = 0;
    const enqueueFailures: Array<{
      subscriptionId: string;
      messageId: string;
      providerId: string;
      tenantId: string;
      reason: string;
    }> = [];

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
          await assertTenantEmailProductAccess(trx, row.tenant);

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

          let enqueueResult;
          try {
            enqueueResult = await enqueueUnifiedInboundEmailQueueJob({
              tenantId: row.tenant,
              providerId: row.id,
              provider: 'microsoft',
              pointer: {
                subscriptionId: notification.subscriptionId,
                messageId,
                resource: notification.resource,
                changeType: notification.changeType,
              },
            });
          } catch (enqueueError: any) {
            const enrichedError = new Error(
              `Failed to enqueue Microsoft pointer job for message ${messageId}`
            ) as Error & {
              code?: string;
              details?: {
                subscriptionId: string;
                messageId: string;
                providerId: string;
                tenantId: string;
                reason: string;
              };
            };
            enrichedError.code = 'UNIFIED_INBOUND_ENQUEUE_FAILED';
            enrichedError.details = {
              subscriptionId: notification.subscriptionId,
              messageId,
              providerId: row.id,
              tenantId: row.tenant,
              reason: enqueueError?.message || String(enqueueError),
            };
            throw enrichedError;
          }

          processedNotifications.push(messageId);
          unifiedQueuedCount += 1;
          console.log('✅ Enqueued unified inbound email pointer job (Microsoft)', {
            providerId: row.id,
            tenantId: row.tenant,
            subscriptionId: notification.subscriptionId,
            messageId,
            queueDepth: enqueueResult.queueDepth,
            jobId: enqueueResult.job.jobId,
          });
        });
      } catch (error: any) {
        console.error('Error processing Microsoft notification:', error);
        if (error?.code === 'UNIFIED_INBOUND_ENQUEUE_FAILED' && error?.details) {
          enqueueFailures.push(error.details);
        }
        // Continue processing other notifications
      }
    }

    if (enqueueFailures.length > 0) {
      return NextResponse.json(
        {
          error: 'Failed to enqueue one or more Microsoft pointer jobs',
          failureCount: enqueueFailures.length,
          failures: enqueueFailures,
        },
        { status: 503 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: unifiedQueuedCount > 0,
      handoff: 'unified_pointer_queue',
      unifiedQueuedCount,
      processedCount: processedNotifications.length,
      messageIds: processedNotifications,
    });

  } catch (error: any) {
    console.error('Microsoft webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Extract message ID from resource URL
function extractMessageId(resource: string): string | null {
  // Resource format: /users/{userId}/messages/{messageId}
  const match = resource.match(/\/messages\/([^\/]+)/);
  return match ? match[1] : null;
}
