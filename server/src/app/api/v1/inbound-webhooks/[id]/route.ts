/**
 * Inbound Webhook Detail API Routes
 * GET /api/v1/inbound-webhooks/{id} - Get inbound webhook details
 * PUT /api/v1/inbound-webhooks/{id} - Update inbound webhook
 * DELETE /api/v1/inbound-webhooks/{id} - Delete inbound webhook
 */

import { NextResponse } from 'next/server';

import {
  deleteInboundWebhook,
  getInboundWebhook,
  upsertInboundWebhook,
} from '@/lib/actions/inboundWebhookActions';
import { handleApiError, NotFoundError } from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await getInboundWebhook(id);

    if (!webhook) {
      throw new NotFoundError('Inbound webhook not found');
    }

    return NextResponse.json({ data: webhook });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const input = await request.json();
    const result = await upsertInboundWebhook({
      ...input,
      inbound_webhook_id: id,
    });

    return NextResponse.json({ data: result.webhook, secret: result.secret });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    await deleteInboundWebhook(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
