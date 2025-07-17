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
  try {
    // Parse Pub/Sub payload
    const payload: GooglePubSubMessage = await request.json();
    console.log('🔔 Google Pub/Sub webhook notification received:', {
      messageId: payload.message?.messageId,
      subscription: payload.subscription,
      timestamp: new Date().toISOString(),
      hasMessageData: !!payload.message?.data
    });

    if (!payload.message?.data) {
      console.log('⚠️  No message data in Pub/Sub payload, skipping processing');
      return NextResponse.json({ success: true, message: 'No data to process' });
    }

    // Verify JWT token (for production security)
    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      console.log('🔐 Verifying JWT token from Pub/Sub');
      try {
        await verifyGoogleToken(token);
        console.log('✅ JWT token verified successfully');
      } catch (error) {
        console.error('❌ JWT verification failed:', error);
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else {
      console.log('⚠️  No JWT token provided in authorization header');
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

      // Extract subscription name from payload
      const subscriptionName = payload.subscription?.split('/').pop();
      console.log(`🔔 Subscription name extracted: ${subscriptionName}`);
      
      const vendorConfig = typeof provider.vendor_config === 'string' 
        ? JSON.parse(provider.vendor_config) 
        : provider.vendor_config;

      // Validate subscription (optional but recommended)
      if (subscriptionName && vendorConfig.pubsubSubscriptionName !== subscriptionName) {
        console.warn(`⚠️  Subscription mismatch for provider ${provider.id}:`, {
          expected: vendorConfig.pubsubSubscriptionName,
          received: subscriptionName,
          provider: provider.id,
          email: notification.emailAddress
        });
      } else {
        console.log(`✅ Subscription validated: ${subscriptionName} matches provider ${provider.id}`);
      }

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
            messageId: payload.message.messageId,
            publishTime: payload.message.publishTime,
            subscription: payload.subscription,
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
      messageId: payload.message.messageId
    });
    
    return NextResponse.json({ 
      success: true,
      processed: processed,
      messageId: payload.message.messageId
    });

  } catch (error: any) {
    console.error('❌ Google webhook handler error:', {
      error: error.message,
      stack: error.stack,
      messageId: payload?.message?.messageId,
      subscription: payload?.subscription
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
async function verifyGoogleToken(token: string): Promise<void> {
  const client = new OAuth2Client();
  
  try {
    // Verify the token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: undefined, // Accept any audience for Pub/Sub
    });
    
    const payload = await ticket.getPayload();
    
    // Verify it's from Google Pub/Sub
    if (payload?.email !== 'pubsub-publishing@system.gserviceaccount.com' &&
        !payload?.email?.endsWith('@system.gserviceaccount.com')) {
      throw new Error('Invalid token issuer');
    }
  } catch (error) {
    console.error('Token verification failed:', error);
    throw error;
  }
}