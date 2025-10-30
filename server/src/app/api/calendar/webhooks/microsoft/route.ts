import { NextRequest, NextResponse } from 'next/server';
import { getAdminConnection } from '@alga-psa/shared/db/admin';
import { withTransaction } from '@alga-psa/shared/db';
import { CalendarWebhookProcessor } from '@/services/calendar/CalendarWebhookProcessor';
import { randomBytes } from 'crypto';

interface MicrosoftNotification {
  changeType: string;
  clientState: string;
  resource: string;
  resourceData: {
    '@odata.type': string;
    '@odata.id': string;
    id: string;
  };
  subscriptionExpirationDateTime: string;
  subscriptionId: string;
  tenantId: string;
}

interface MicrosoftWebhookPayload {
  value: MicrosoftNotification[];
}

/**
 * Handle GET requests for Microsoft Calendar webhook validation
 */
export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const validationToken = url.searchParams.get('validationtoken') || url.searchParams.get('validationToken');
    if (validationToken) {
      console.log('Microsoft Calendar webhook validation (GET) received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('Microsoft Calendar webhook GET handler error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

/**
 * Handle POST requests for Microsoft Calendar webhook notifications
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
      console.log('Microsoft Calendar webhook validation (POST) received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    // Parse webhook payload
    let payload: MicrosoftWebhookPayload | undefined;
    try {
      const raw = await request.text();
      if (!raw) {
        console.log('Microsoft Calendar webhook POST received with empty body (likely validation probe)');
        return new NextResponse('OK', { status: 200 });
      }
      payload = JSON.parse(raw);
    } catch (parseErr) {
      console.warn('Microsoft Calendar webhook POST with non-JSON body:', parseErr);
      return new NextResponse('OK', { status: 200 });
    }

    if (!payload) {
      console.log('Microsoft Calendar webhook POST received with null payload');
      return new NextResponse('OK', { status: 200 });
    }

    console.log('📅 Microsoft Calendar webhook notification received:', {
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

    // Process webhook notifications
    const processor = new CalendarWebhookProcessor();
    const result = await processor.processMicrosoftWebhook(payload.value);

    return NextResponse.json({
      success: result.failed === 0,
      processed: result.success,
      failed: result.failed
    });

  } catch (error: any) {
    console.error('Microsoft Calendar webhook handler error:', error);
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

