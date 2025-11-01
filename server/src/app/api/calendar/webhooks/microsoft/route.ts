import { NextRequest, NextResponse } from 'next/server';
import { CalendarWebhookProcessor } from '@/services/calendar/CalendarWebhookProcessor';

const processor = new CalendarWebhookProcessor();

interface ValidationToken {
  raw: string;
  decoded: string;
}

function extractValidationToken(request: NextRequest): ValidationToken | null {
  const headerToken =
    request.headers.get('validationtoken') ||
    request.headers.get('ValidationToken');
  if (headerToken) {
    return { raw: headerToken, decoded: headerToken };
  }

  const search = request.nextUrl.search;
  if (!search) {
    return null;
  }

  const match = search.match(/[?&]validationtoken=([^&]+)/i);
  if (!match) {
    return null;
  }

  const rawToken = match[1];
  try {
    return {
      raw: rawToken,
      decoded: decodeURIComponent(rawToken.replace(/\+/g, ' '))
    };
  } catch {
    return {
      raw: rawToken,
      decoded: rawToken
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    console.log('[Microsoft Calendar Webhook] GET received', {
      url: request.nextUrl.toString()
    });
    const validationToken = extractValidationToken(request);
    if (validationToken) {
      console.log('[Microsoft Calendar Webhook] Validation (GET) token received', {
        rawLength: validationToken.raw.length,
        decodedLength: validationToken.decoded.length
      });
      const body = validationToken.decoded;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body, 'utf8').toString()
        }
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
    console.log('[Microsoft Calendar Webhook] POST received', {
      url: request.nextUrl.toString()
    });
    const validationToken = extractValidationToken(request);
    if (validationToken) {
      console.log('[Microsoft Calendar Webhook] Validation (POST) token received', {
        rawLength: validationToken.raw.length,
        decodedLength: validationToken.decoded.length
      });
      const body = validationToken.decoded;
      return new NextResponse(body, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
          'Content-Length': Buffer.byteLength(body, 'utf8').toString()
        }
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
