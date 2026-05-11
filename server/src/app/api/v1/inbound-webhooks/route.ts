/**
 * Inbound Webhooks API Routes
 * GET /api/v1/inbound-webhooks - List inbound webhooks
 * POST /api/v1/inbound-webhooks - Create inbound webhook
 */

import { NextResponse } from 'next/server';

import { listInboundWebhooks, upsertInboundWebhook } from '@/lib/actions/inboundWebhookActions';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET() {
  try {
    const webhooks = await listInboundWebhooks();
    return NextResponse.json({ data: webhooks });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const result = await upsertInboundWebhook(input);
    return NextResponse.json({ data: result.webhook, secret: result.secret }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
