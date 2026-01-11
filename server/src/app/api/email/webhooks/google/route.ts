import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { withTransaction } from '@alga-psa/shared/db';
import { publishEvent } from '@alga-psa/shared/events/publisher';
import { GmailAdapter } from '@/services/email/providers/GmailAdapter';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';
import { OAuth2Client } from 'google-auth-library';
import { getSecretProviderInstance } from '@shared/core';

interface GooglePubSubMessage {
  message: {
    data: string; // Base64 encoded
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GmailNotification {
  emailAddress: string;
  historyId: string;
}

export async function POST(request: NextRequest) {
  // Initialize variables that might be needed in catch block
  let payloadData: { messageId?: string; publishTime?: string; subscription?: string } = {};
  
  try {
    // Parse Pub/Sub payload
    const payload: GooglePubSubMessage = await request.json();
    
    // Add detailed logging of the incoming message structure
    console.log('🔔 Google Pub/Sub webhook notification received:', {
      messageId: payload.message?.messageId,
      subscription: payload.subscription,
      timestamp: new Date().toISOString(),
      hasMessageData: !!payload.message?.data,
      fullPayload: JSON.stringify(payload, null, 2)
    });
    
    // Debug: Log the complete payload structure
    console.log('🔍 Complete payload structure:', {
      payload: payload,
      messageKeys: payload.message ? Object.keys(payload.message) : 'No message object',
      subscriptionType: typeof payload.subscription,
      subscriptionValue: payload.subscription
    });

    if (!payload.message?.data) {
      console.log('⚠️  No message data in Pub/Sub payload, skipping processing');
      return NextResponse.json({ success: true, message: 'No data to process' });
    }

    // Require JWT token (required for security)
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('❌ No JWT token provided - Pub/Sub notifications must include JWT tokens');
      return NextResponse.json({ error: 'Unauthorized - JWT token required' }, { status: 401 });
    }
    const token = authHeader.substring(7);

    // Decode base64 message data
    console.log('🔓 Decoding base64 message data');
    const decodedData = Buffer.from(payload.message.data, 'base64').toString();
    const notification: GmailNotification = JSON.parse(decodedData);

    console.log('📧 Decoded Gmail notification:', {
      emailAddress: notification.emailAddress,
      historyId: notification.historyId
    });

    const knex = await getAdminConnection();
    let processed = false;
    
    // Store payload data to ensure it's accessible in all scopes
    payloadData = {
      messageId: payload.message.messageId,
      publishTime: payload.message.publishTime,
      subscription: payload.subscription
    };
    
    console.log('🔍 Payload data extracted for processing:', payloadData);

    // Resolve provider + google config BEFORE doing any side effects, so we can validate JWT issuer
    const subscriptionName = payloadData.subscription?.split('/').pop();
    console.log(`🔔 Subscription name extracted: ${subscriptionName}`);

    let provider = null as any;
    let googleConfig = null as any;

    if (subscriptionName) {
      try {
        const cfg = await knex('google_email_provider_config')
          .select('email_provider_id')
          .where('pubsub_subscription_name', subscriptionName)
          .first();
        if (cfg?.email_provider_id) {
          provider = await knex('email_providers')
            .where('id', cfg.email_provider_id)
            .andWhere('provider_type', 'google')
            .andWhere('is_active', true)
            .first();
          if (provider) {
            console.log(`✅ Mapped provider via subscription ${subscriptionName}: ${provider.id}`);
          }
        }
      } catch (mapErr: any) {
        console.warn('⚠️ Failed subscription→provider mapping, will fallback to email lookup:', mapErr?.message || mapErr);
      }
    }

    if (!provider) {
      console.log(`🔍 Looking up Gmail provider by address: ${notification.emailAddress}`);
      provider = await knex('email_providers')
        .where('mailbox', notification.emailAddress)
        .andWhere('provider_type', 'google')
        .andWhere('is_active', true)
        .first();
    }

    if (!provider) {
      console.error(`❌ Active Gmail provider not found (subscription=${subscriptionName} email=${notification.emailAddress})`);
      return NextResponse.json({ success: true, message: 'No provider found' });
    }

    console.log(`✅ Found Gmail provider: ${provider.id} for ${notification.emailAddress}`);

    googleConfig = await knex('google_email_provider_config')
      .where('email_provider_id', provider.id)
      .first();

    if (!googleConfig) {
      console.error(`❌ Google config not found for provider: ${provider.id}`);
      return NextResponse.json({ success: true, message: 'No google config found' });
    }

    // Verify JWT token (audience + issuer), now that we know which tenant/provider this webhook maps to
    const webhookUrl = `${request.nextUrl.origin}${request.nextUrl.pathname}`;
    console.log('🔐 Verifying JWT token from Pub/Sub', {
      webhookUrl,
      providerId: provider.id,
      tenant: provider.tenant,
      projectId: googleConfig.project_id,
    });

    try {
      const secretProvider = await getSecretProviderInstance();
      const serviceAccountKey = await secretProvider.getTenantSecret(provider.tenant, 'google_service_account_key');
      let allowedServiceAccountEmail: string | undefined;

      if (serviceAccountKey) {
        try {
          const parsed = JSON.parse(serviceAccountKey);
          if (parsed?.client_email && typeof parsed.client_email === 'string') {
            allowedServiceAccountEmail = parsed.client_email;
          }
        } catch {
          // Ignore parse errors; we can still fall back to project_id-based suffix check below
        }
      }

      await verifyGoogleToken(token, webhookUrl, {
        allowedServiceAccountEmail,
        allowedProjectId: googleConfig.project_id,
      });
      console.log('✅ JWT token verified successfully');
    } catch (error) {
      console.error('❌ JWT verification failed:', error);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await withTransaction(knex, async (trx) => {
      // Ensure we use the transactional connection for writes from here on
      // Validate subscription (optional but recommended)
      if (subscriptionName && googleConfig.pubsub_subscription_name !== subscriptionName) {
        console.warn(`⚠️  Subscription mismatch for provider ${provider.id}:`, {
          expected: googleConfig.pubsub_subscription_name,
          received: subscriptionName,
          provider: provider.id,
          email: notification.emailAddress
        });
      } else {
        console.log(`✅ Subscription validated: ${subscriptionName} matches provider ${provider.id}`);
      }

      console.log(`✅ Loaded Google config for provider: ${provider.id}`, {
        hasConfig: !!googleConfig,
        pubsubSubscriptionName: googleConfig.pubsub_subscription_name
      });

      // Check if this historyId has already been processed to prevent duplicates
      const existingProcessed = await trx('gmail_processed_history')
        .where('tenant', provider.tenant)
        .where('provider_id', provider.id)
        .where('history_id', notification.historyId)
        .first();

      // if (existingProcessed) {
      //   console.log(`⚠️  HistoryId ${notification.historyId} already processed for provider ${provider.id}, skipping duplicate`);
      //   processed = true; // Mark as processed to avoid error
      //   return; // Exit early - this is a duplicate
      // }

      // Record this historyId as processed
      await trx('gmail_processed_history').insert({
        tenant: provider.tenant,
        provider_id: provider.id,
        history_id: notification.historyId,
        message_id: payloadData.messageId,
        processed_at: new Date().toISOString()
      });

      console.log(`✅ Recorded historyId ${notification.historyId} as processed for provider ${provider.id}`);
    

      // Guard: ensure OAuth tokens exist before attempting Gmail API calls
      if (!googleConfig.access_token || !googleConfig.refresh_token) {
        console.warn(`⚠️  Gmail OAuth tokens missing for provider ${provider.id}. Skipping fetch and marking provider as error.`);
        const missingTokensMessage = 'Gmail OAuth tokens missing. Reconnect the Gmail provider to continue.';
        await trx('email_providers')
          .where({ id: provider.id, tenant: provider.tenant })
          .update({
            status: 'error',
            error_message: missingTokensMessage
          });
        console.log('🚨 Flagged Gmail provider status as error because OAuth tokens are missing.');
        return; // Exit transaction early; webhook will be acked below without events
      }

      // Build EmailProviderConfig for GmailAdapter
      const providerConfig: EmailProviderConfig = {
        id: provider.id,
        tenant: provider.tenant,
        name: provider.name || provider.mailbox,
        provider_type: 'google',
        mailbox: provider.mailbox,
        folder_to_monitor: 'Inbox',
        active: provider.is_active,
        webhook_notification_url: provider.webhook_notification_url,
        connection_status: provider.connection_status || 'connected',
        created_at: provider.created_at,
        updated_at: provider.updated_at,
        provider_config: {
          project_id: googleConfig.project_id,
          pubsub_topic_name: googleConfig.pubsub_topic_name,
          pubsub_subscription_name: googleConfig.pubsub_subscription_name,
          client_id: googleConfig.client_id,
          client_secret: googleConfig.client_secret,
          access_token: googleConfig.access_token,
          refresh_token: googleConfig.refresh_token,
          token_expires_at: googleConfig.token_expires_at,
          history_id: googleConfig.history_id,
          watch_expiration: googleConfig.watch_expiration,
        },
      } as any;

      try {
        // Use GmailAdapter to fetch message IDs since historyId and publish enriched events
        const adapter = new GmailAdapter(providerConfig);
        await adapter.connect();

        // Per Gmail docs, list history since our last saved history_id, not the incoming one
        const startHistoryId = String(googleConfig.history_id || ((Number(notification.historyId) || 0) - 1));
        console.log(`🔎 Listing Gmail messages since saved historyId ${startHistoryId} (notification ${notification.historyId})`);
        const messageIds = await adapter.listMessagesSince(startHistoryId);

        if (!messageIds || messageIds.length === 0) {
          console.log(`ℹ️ No new Gmail messages since historyId ${notification.historyId} for ${provider.mailbox}`);
        } else {
          console.log(`📬 Found ${messageIds.length} new Gmail message(s) to publish`);
        }

        // Publish one INBOUND_EMAIL_RECEIVED per Gmail message with full emailData
        for (const msgId of messageIds) {
          try {
            const details = await adapter.getMessageDetails(msgId);
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
            console.log(`✅ Published INBOUND_EMAIL_RECEIVED with emailData for ${msgId}`);
            processed = true;
          } catch (detailErr: any) {
            console.warn(`⚠️ Failed to fetch/publish Gmail message ${msgId}: ${detailErr.message}`);
          }
        }

        // Update last_sync_at after successful email processing
        if (processed) {
          await trx('email_providers')
            .where({ id: provider.id, tenant: provider.tenant })
            .update({
              last_sync_at: trx.fn.now(),
              updated_at: trx.fn.now()
            });
        }

        // Advance our stored history cursor to the latest notification's historyId
        try {
          await trx('google_email_provider_config')
            .where({ tenant: provider.tenant, email_provider_id: provider.id })
            .update({ history_id: String(notification.historyId), updated_at: trx.fn.now() });
          console.log(`📝 Updated stored Gmail history_id to ${notification.historyId} for provider ${provider.id}`);
        } catch (updateHistoryErr: any) {
          console.warn('⚠️ Failed to persist updated history_id:', updateHistoryErr?.message || updateHistoryErr);
        }
      } catch (oauthErr: any) {
        const msg = oauthErr?.message || String(oauthErr);
        const raw = typeof oauthErr === 'object' ? JSON.stringify(oauthErr) : String(oauthErr);
        console.error('[GOOGLE] OAuth error while fetching Gmail messages:', { message: msg, raw });

        if (oauthErr?.code === 'gmail.historyIdNotFound') {
          console.warn('⚠️ Gmail history_id is invalid or expired; clearing stored cursor and flagging provider for resync.');
          try {
            await trx('google_email_provider_config')
              .where({ tenant: provider.tenant, email_provider_id: provider.id })
              .update({ history_id: null, updated_at: trx.fn.now() });
            console.log('🧹 Cleared stored Gmail history_id due to cursor invalidation.');
          } catch (clearErr: any) {
            console.warn('⚠️ Failed to clear invalid Gmail history_id:', clearErr?.message || clearErr);
          }

          const cursorExpiredMessage = 'Gmail history cursor expired. Resync Gmail provider to continue processing.';
          await trx('email_providers')
            .where({ id: provider.id, tenant: provider.tenant })
            .update({
              status: 'error',
              error_message: cursorExpiredMessage
            });
          console.log('🚨 Flagged Gmail provider status as error to prompt resync.');
        } else if (msg.includes('invalid_grant') || msg.includes('invalid_rapt')) {
          console.error('⚠️ Gmail OAuth requires re-authorization (invalid_grant/invalid_rapt). Marking provider as error.');
          try {
            await trx('email_providers')
              .where({ id: provider.id, tenant: provider.tenant })
              .update({
                status: 'error',
                error_message: 'Gmail requires re-authorization (invalid_grant/invalid_rapt). Visit settings to reconnect.'
              });
          } catch (updateErr) {
            console.warn('Failed to update provider connection_status after OAuth error:', updateErr);
          }
          // Do not throw; acknowledge webhook without publishing events to avoid retries storm
        } else {
          // Unknown error; log and continue (acknowledge webhook)
          console.error('Unhandled Gmail fetch error:', msg);
        }
      }
    });

    // Acknowledge the message
    console.log(`📋 Webhook processing complete:`, {
      success: true,
      processed: processed,
      messageId: payloadData.messageId
    });
    
    return NextResponse.json({ 
      success: true,
      processed: processed,
      messageId: payloadData.messageId
    });

  } catch (error: any) {
    console.error('❌ Google webhook handler error:', {
      error: error.message,
      stack: error.stack,
      messageId: payloadData?.messageId || 'unknown',
      subscription: payloadData?.subscription || 'unknown'
    });
    // Return 200 to avoid Pub/Sub retries for permanent errors
    return NextResponse.json({ 
      success: false,
      error: error.message 
    });
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

// Verify Google JWT token
async function verifyGoogleToken(
  token: string,
  expectedAudience: string,
  opts: { allowedServiceAccountEmail?: string; allowedProjectId?: string } = {}
): Promise<void> {
  const client = new OAuth2Client();
  
  try {
    // First decode the token to see what audience it has
    const decodedToken = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    console.log('🔍 JWT token payload:', {
      audience: decodedToken.aud,
      issuer: decodedToken.iss,
      subject: decodedToken.sub,
      email: decodedToken.email
    });
    
    // Verify the token with the expected audience (do NOT trust the token's own aud)
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: expectedAudience,
    });
    
    const payload = await ticket.getPayload();
    
    const email = payload?.email;
    const allowedExact = new Set(
      [opts.allowedServiceAccountEmail, 'pubsub-publishing@system.gserviceaccount.com'].filter(Boolean) as string[]
    );
    const allowedSuffix =
      opts.allowedProjectId && typeof opts.allowedProjectId === 'string'
        ? `@${opts.allowedProjectId}.iam.gserviceaccount.com`
        : undefined;

    const isAllowed =
      !!email &&
      (allowedExact.has(email) || (allowedSuffix ? email.endsWith(allowedSuffix) : false));

    if (!isAllowed) {
      throw new Error(
        `Invalid token issuer: ${email || 'unknown'} (allowed=${
          Array.from(allowedExact).join(',') || 'none'
        }${allowedSuffix ? ` suffix=${allowedSuffix}` : ''})`
      );
    }

    console.log('🔐 JWT token verified successfully:', {
      issuer: payload?.email,
      audience: payload?.aud,
      subject: payload?.sub,
      expectedAudience: expectedAudience
    });
  } catch (error) {
    console.error('Token verification failed:', error);
    throw error;
  }
}
