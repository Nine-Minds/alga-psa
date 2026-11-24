/**
 * Inbound Webhooks API Routes
 * GET /api/v1/inbound-webhooks - List inbound webhooks
 * POST /api/v1/inbound-webhooks - Create inbound webhook
 */

import { NextResponse } from 'next/server';

import { listInboundWebhooks, upsertInboundWebhook } from '@/lib/actions/inboundWebhookActions';
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
} from 'server/src/lib/api/middleware/apiMiddleware';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';

export async function GET(request: Request) {
  try {
    const webhooks = await runWithApiKeyOrSession(request, () => listInboundWebhooks());
    if (isServerActionErrorResult(webhooks)) {
      return createServerActionErrorResponse(webhooks);
    }
    return NextResponse.json({ data: webhooks });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const result = await runWithApiKeyOrSession(request, () => upsertInboundWebhook(input));
    if (isServerActionErrorResult(result)) {
      return createServerActionErrorResponse(result);
    }
    return NextResponse.json({ data: result.webhook, secret: result.secret }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
