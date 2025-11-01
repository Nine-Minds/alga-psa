import { NextRequest, NextResponse } from 'next/server';
import { CalendarWebhookProcessor } from '@/services/calendar/CalendarWebhookProcessor';

const processor = new CalendarWebhookProcessor();

function extractValidationToken(request: NextRequest): string | null {
  const url = request.nextUrl;
  return (
    request.headers.get('validationtoken') ||
    request.headers.get('ValidationToken') ||
    url.searchParams.get('validationtoken') ||
    url.searchParams.get('validationToken') ||
    null
  );
}

export async function GET(request: NextRequest) {
  try {
    const validationToken = extractValidationToken(request);
    if (validationToken) {
      console.log('[Microsoft Calendar Webhook] Validation (GET) token received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
    return new NextResponse('OK', { status: 200 });
  } catch (error) {
    console.error('[Microsoft Calendar Webhook] GET handler error:', error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const validationToken = extractValidationToken(request);
    if (validationToken) {
      console.log('[Microsoft Calendar Webhook] Validation (POST) token received');
      return new NextResponse(validationToken, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' }
      });
    }

    let payload: any = undefined;
    try {
      const raw = await request.text();
      if (raw) {
        payload = JSON.parse(raw);
      }
    } catch (parseError) {
      console.warn('[Microsoft Calendar Webhook] Non-JSON payload received', parseError);
    }

    const notifications = payload?.value;
    if (!Array.isArray(notifications) || notifications.length === 0) {
      console.log('[Microsoft Calendar Webhook] No notifications to process');
      return NextResponse.json({ success: true, processed: 0 });
    }

    console.log('[Microsoft Calendar Webhook] Notifications received', {
      count: notifications.length,
      first: {
        subscriptionId: notifications[0]?.subscriptionId,
        changeType: notifications[0]?.changeType,
        resource: notifications[0]?.resource
      }
    });

    const result = await processor.processMicrosoftWebhook(notifications);
    return NextResponse.json({
      success: true,
      processed: result.success,
      failed: result.failed
    });
  } catch (error) {
    console.error('[Microsoft Calendar Webhook] POST handler error:', error);
    return new NextResponse(
      JSON.stringify({ success: false, error: (error as Error).message || 'Internal Server Error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}
