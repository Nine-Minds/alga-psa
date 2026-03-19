import { NextRequest, NextResponse } from 'next/server';
import { CalendarWebhookProcessor } from '@alga-psa/ee-calendar/lib/services/calendar/CalendarWebhookProcessor';
import { getAdminConnection } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';

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

    const startTime = Date.now();

    setImmediate(async () => {
      try {
        const subscriptionIds = new Set<string>();
        for (const notification of notifications) {
          if (notification?.subscriptionId) {
            subscriptionIds.add(notification.subscriptionId);
          }
        }

        if (subscriptionIds.size > 0) {
          try {
            const knex = await getAdminConnection();
            const now = new Date().toISOString();

            const providers = await knex('microsoft_calendar_provider_config as mcp')
              .join('calendar_providers as cp', function() {
                this.on('mcp.calendar_provider_id', '=', 'cp.id')
                  .andOn('mcp.tenant', '=', 'cp.tenant');
              })
              .whereIn('mcp.webhook_subscription_id', Array.from(subscriptionIds))
              .select('cp.id as provider_id', 'cp.tenant');

            for (const provider of providers) {
              const existing = await knex('calendar_provider_health')
                .where('calendar_provider_id', provider.provider_id)
                .andWhere('tenant', provider.tenant)
                .first();

              if (existing) {
                await knex('calendar_provider_health')
                  .where('calendar_provider_id', provider.provider_id)
                  .andWhere('tenant', provider.tenant)
                  .update({
                    last_webhook_received_at: now,
                    updated_at: now
                  });
              } else {
                await knex('calendar_provider_health')
                  .insert({
                    calendar_provider_id: provider.provider_id,
                    tenant: provider.tenant,
                    last_webhook_received_at: now,
                    created_at: now,
                    updated_at: now
                  });
              }
            }
          } catch (error: any) {
            logger.warn('[Microsoft Calendar Webhook] Failed to update health table', { error: error.message });
          }
        }

        const result = await processor.processMicrosoftWebhook(notifications);
        console.log(`[Microsoft Calendar Webhook] Processed in ${Date.now() - startTime}ms`, {
          success: result.success,
          failed: result.failed
        });
      } catch (error) {
        console.error('[Microsoft Calendar Webhook] Background processing error:', error);
      }
    });

    return NextResponse.json({ success: true, accepted: notifications.length });
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

export async function OPTIONS(_request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
