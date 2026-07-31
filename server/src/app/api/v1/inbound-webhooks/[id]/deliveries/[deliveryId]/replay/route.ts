/**
 * Inbound Webhook Delivery Replay API Route
 * POST /api/v1/inbound-webhooks/{id}/deliveries/{deliveryId}/replay - Replay inbound webhook delivery
 */

import { NextResponse } from 'next/server';

import { getInboundDelivery, replayInboundDelivery } from '@/lib/actions/inboundWebhookActions';
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
  NotFoundError,
} from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string; deliveryId: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id, deliveryId } = await context.params;
    const original = await getInboundDelivery(deliveryId);
    if (isServerActionErrorResult(original)) {
      return createServerActionErrorResponse(original);
    }

    if (!original || original.inboundWebhookId !== id) {
      throw new NotFoundError('Inbound delivery not found');
    }

    const replayedDelivery = await replayInboundDelivery(deliveryId);
    if (isServerActionErrorResult(replayedDelivery)) {
      return createServerActionErrorResponse(replayedDelivery);
    }
    return NextResponse.json({ data: replayedDelivery }, { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
