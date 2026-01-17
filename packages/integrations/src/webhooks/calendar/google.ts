import { NextRequest, NextResponse } from 'next/server';
import { CalendarWebhookProcessor } from 'server/src/services/calendar/CalendarWebhookProcessor';

interface GooglePubSubMessage {
  message: {
    data: string;
    messageId: string;
    publishTime: string;
  };
  subscription: string;
}

interface GoogleCalendarNotification {
  resourceState?: string;
  resourceId?: string;
  resourceUri?: string;
  channelId?: string;
  channelExpiration?: string;
  channelToken?: string;
  changed?: string;
}

/**
 * Handle GET requests for Google Calendar webhook validation
 */
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const validationToken = url.searchParams.get('validationtoken') || url.searchParams.get('validationToken');
    if (validationToken) {
      console.log('Google Calendar webhook validation (GET) received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('Google Calendar webhook GET handler error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * Handle POST requests for Google Calendar webhook notifications (Pub/Sub)
 */
export async function POST(request: NextRequest) {
  try {
    // Google Calendar push notifications (web_hook) send headers and usually an empty body.
    const channelId =
      request.headers.get('x-goog-channel-id') ||
      request.headers.get('X-Goog-Channel-Id');

    if (channelId) {
      const resourceId = request.headers.get('x-goog-resource-id') || request.headers.get('X-Goog-Resource-Id');
      const resourceState = request.headers.get('x-goog-resource-state') || request.headers.get('X-Goog-Resource-State');
      const token = request.headers.get('x-goog-channel-token') || request.headers.get('X-Goog-Channel-Token');

      console.log('📅 Google Calendar channel webhook received:', {
        channelId,
        resourceId,
        resourceState,
        timestamp: new Date().toISOString()
      });

      const startTime = Date.now();
      setImmediate(async () => {
        try {
          const processor = new CalendarWebhookProcessor();
          const result = await processor.processGoogleChannelWebhook({
            channelId,
            resourceId,
            resourceState,
            token
          });
          console.log(`[Google Calendar Webhook] Channel processed in ${Date.now() - startTime}ms`, result);
        } catch (error) {
          console.error('[Google Calendar Webhook] Channel background processing error:', error);
        }
      });

      return NextResponse.json({ success: true, accepted: true });
    }

    // Handle subscription validation
    const url = request.nextUrl;
    const validationToken =
      request.headers.get('validationtoken') ||
      request.headers.get('ValidationToken') ||
      url.searchParams.get('validationtoken') ||
      url.searchParams.get('validationToken');
    
    if (validationToken) {
      console.log('Google Calendar webhook validation (POST) received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Parse Pub/Sub payload
    const payload: GooglePubSubMessage = await request.json();
    
    console.log('📅 Google Calendar Pub/Sub webhook notification received:', {
      messageId: payload.message?.messageId,
      subscription: payload.subscription,
      timestamp: new Date().toISOString()
    });

    if (!payload.message?.data) {
      console.log('⚠️ No message data in Pub/Sub payload, skipping processing');
      return NextResponse.json({ success: true, message: 'No data to process' });
    }

    // Extract subscription name from full subscription path
    const subscriptionName = payload.subscription?.split('/').pop();

    if (!subscriptionName) {
      console.error('❌ Could not extract subscription name from payload');
      return NextResponse.json(
        { success: false, error: 'Invalid subscription format' },
        { status: 400 }
      );
    }

    // Acknowledge webhook immediately, process asynchronously
    // This prevents Pub/Sub from retrying due to slow processing
    const startTime = Date.now();
    const messageForProcessing = payload.message;

    // Process in background after responding
    setImmediate(async () => {
      try {
        const processor = new CalendarWebhookProcessor();
        const result = await processor.processGoogleWebhook(messageForProcessing, subscriptionName);
        console.log(`[Google Calendar Webhook] Processed in ${Date.now() - startTime}ms`, {
          success: result.success,
          failed: result.failed
        });
      } catch (error) {
        console.error('[Google Calendar Webhook] Background processing error:', error);
      }
    });

    // Return immediately
    return NextResponse.json({ success: true, accepted: true });

  } catch (error: any) {
    console.error('Google Calendar webhook handler error:', error);
    return NextResponse.json(
      { error: 'Internal server error', message: error.message },
      { status: 500 }
    );
  }
}

/**
 * Handle OPTIONS for CORS
 */
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
