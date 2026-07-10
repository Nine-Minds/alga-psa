/**
 * Inbound Webhook Test API Route
 * POST /api/v1/inbound-webhooks/{id}/test - Dispatch synthetic inbound webhook payload
 */

import { NextResponse } from 'next/server';

import { sendInboundWebhookTest } from '@/lib/actions/inboundWebhookActions';
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
} from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = await request.json();
    const delivery = await sendInboundWebhookTest(id, input);
    if (isServerActionErrorResult(delivery)) {
      return createServerActionErrorResponse(delivery);
    }
    return NextResponse.json({ data: delivery }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
