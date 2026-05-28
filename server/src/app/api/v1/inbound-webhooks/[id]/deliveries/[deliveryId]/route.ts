/**
 * Inbound Webhook Delivery Detail API Route
 * GET /api/v1/inbound-webhooks/{id}/deliveries/{deliveryId} - Get inbound webhook delivery
 */

import { NextResponse } from 'next/server';

import { getInboundDelivery } from '@/lib/actions/inboundWebhookActions';
import { handleApiError, NotFoundError } from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string; deliveryId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id, deliveryId } = await context.params;
    const delivery = await getInboundDelivery(deliveryId);

    if (!delivery || delivery.inboundWebhookId !== id) {
      throw new NotFoundError('Inbound delivery not found');
    }

    return NextResponse.json({ data: delivery });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
