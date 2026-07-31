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
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
  NotFoundError,
} from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await getInboundWebhook(id);
    if (isServerActionErrorResult(webhook)) {
      return createServerActionErrorResponse(webhook);
    }

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
    if (isServerActionErrorResult(result)) {
      return createServerActionErrorResponse(result);
    }

    return NextResponse.json({ data: result.webhook, secret: result.secret });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await deleteInboundWebhook(id);
    if (isServerActionErrorResult(result)) {
      return createServerActionErrorResponse(result);
    }
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
