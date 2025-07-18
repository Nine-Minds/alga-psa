import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@shared/db/admin';
import { withTransaction } from '@shared/db';
import { publishEvent } from '@shared/events/publisher';
import { OAuth2Client } from 'google-auth-library';

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

    // Verify JWT token (required for security)
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      console.log('🔐 Verifying JWT token from Pub/Sub');
      try {
        const webhookUrl = `${request.nextUrl.origin}${request.nextUrl.pathname}`;
        await verifyGoogleToken(token, webhookUrl);
        console.log('✅ JWT token verified successfully');
      } catch (error) {
        console.error('❌ JWT verification failed:', error);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.error('❌ No JWT token provided - Pub/Sub notifications must include JWT tokens');
      return NextResponse.json({ error: 'Unauthorized - JWT token required' }, { status: 401 });
    }

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

    await withTransaction(knex, async (trx) => {
      // Look up provider by email address
      console.log(`🔍 Looking up Gmail provider for email: ${notification.emailAddress}`);
      const provider = await trx('email_providers')
        .where('mailbox', notification.emailAddress)
        .where('provider_type', 'google')
        .where('is_active', true)
        .first();

      if (!provider) {
        console.error(`❌ Active Gmail provider not found for email: ${notification.emailAddress}`);
        return;
      }

      console.log(`✅ Found Gmail provider: ${provider.id} for ${notification.emailAddress}`);

      // Load Google-specific vendor configuration
      const googleConfig = await trx('google_email_provider_config')
        .where('email_provider_id', provider.id)
        .first();

      if (!googleConfig) {
        console.error(`❌ Google config not found for provider: ${provider.id}`);
        return;
      }

      console.log(`✅ Loaded Google config for provider: ${provider.id}`, {
        hasConfig: !!googleConfig,
        pubsubSubscriptionName: googleConfig.pubsub_subscription_name
      });

      // Extract subscription name from payload
      const subscriptionName = payloadData.subscription?.split('/').pop();
      console.log(`🔔 Subscription name extracted: ${subscriptionName}`);

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
    

      // Publish INBOUND_EMAIL_RECEIVED event
      console.log(`📤 Publishing INBOUND_EMAIL_RECEIVED event for provider ${provider.id}`);
      await publishEvent({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        tenant: provider.tenant,
        payload: {
          providerId: provider.id,
          providerType: 'google',
          mailbox: provider.mailbox,
          historyId: notification.historyId,
          webhookData: {
            emailAddress: notification.emailAddress,
            historyId: notification.historyId,
            messageId: payloadData.messageId,
            publishTime: payloadData.publishTime,
            subscription: payloadData.subscription,
            timestamp: new Date().toISOString()
          }
        }
      });

      processed = true;
      console.log(`✅ Published INBOUND_EMAIL_RECEIVED event for Gmail:`, {
        email: notification.emailAddress,
        historyId: notification.historyId,
        providerId: provider.id,
        tenant: provider.tenant
      });
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
async function verifyGoogleToken(token: string, expectedAudience: string): Promise<void> {
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
    
    // Verify the token with the actual audience from the token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: decodedToken.aud, // Use the audience from the token itself
    });
    
    const payload = await ticket.getPayload();
    
    // Verify it's from Google Pub/Sub or our configured service account
    if (payload?.email !== 'pubsub-publishing@system.gserviceaccount.com' &&
        !payload?.email?.endsWith('@system.gserviceaccount.com') &&
        !payload?.email?.endsWith('@alga-psa-466214.iam.gserviceaccount.com')) {
      throw new Error('Invalid token issuer');
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