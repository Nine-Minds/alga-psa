/**
 * Inbound Webhooks API Routes
 * GET /api/v1/inbound-webhooks - List inbound webhooks
 */

import { NextResponse } from 'next/server';

import { listInboundWebhooks } from '@/lib/actions/inboundWebhookActions';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET() {
  try {
    const webhooks = await listInboundWebhooks();
    return NextResponse.json({ data: webhooks });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
