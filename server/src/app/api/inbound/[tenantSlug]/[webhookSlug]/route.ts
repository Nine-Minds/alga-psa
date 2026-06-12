import type { NextRequest, NextResponse } from 'next/server';

import { processInboundWebhookRequest } from '@/lib/inboundWebhooks/requestProcessor';

type InboundWebhookRouteContext = {
  params: Promise<{
    tenantSlug: string;
    webhookSlug: string;
  }>;
};

async function handleInboundWebhookRequest(
  request: NextRequest,
  context: InboundWebhookRouteContext,
): Promise<NextResponse> {
  const { tenantSlug, webhookSlug } = await context.params;
  return processInboundWebhookRequest({ request, tenantSlug, webhookSlug });
}

export const POST = handleInboundWebhookRequest;
export const PUT = handleInboundWebhookRequest;
export const PATCH = handleInboundWebhookRequest;

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
