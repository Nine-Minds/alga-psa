import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { withTransaction } from '@alga-psa/shared/db';
import { CalendarWebhookProcessor } from '@/services/calendar/CalendarWebhookProcessor';

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

    // Process webhook notification
    const processor = new CalendarWebhookProcessor();
    const result = await processor.processGoogleWebhook(payload.message, subscriptionName);

    return NextResponse.json({
      success: result.failed === 0,
      processed: result.success,
      failed: result.failed
    });

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

