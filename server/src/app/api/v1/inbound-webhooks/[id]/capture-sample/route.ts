/**
 * Inbound Webhook Sample Capture API Routes
 * POST /api/v1/inbound-webhooks/{id}/capture-sample - Enable sample capture
 * DELETE /api/v1/inbound-webhooks/{id}/capture-sample - Clear captured sample
 */

import { NextResponse } from 'next/server';

import { captureSamplePayload, clearSamplePayload } from '@/lib/actions/inboundWebhookActions';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await captureSamplePayload(id);
    return NextResponse.json({ data: webhook });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await clearSamplePayload(id);
    return NextResponse.json({ data: webhook });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
