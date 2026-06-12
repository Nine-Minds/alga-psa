/**
 * Inbound Webhook Secret API Route
 * POST /api/v1/inbound-webhooks/{id}/rotate-secret - Rotate inbound webhook secret
 */

import { NextResponse } from 'next/server';

import { rotateInboundWebhookSecret } from '@/lib/actions/inboundWebhookActions';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const result = await rotateInboundWebhookSecret(id);
    return NextResponse.json({ data: result.webhook, secret: result.secret });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
