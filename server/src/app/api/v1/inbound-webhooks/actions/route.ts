/**
 * Inbound Webhook Actions API Route
 * GET /api/v1/inbound-webhooks/actions - List inbound-callable action definitions
 */

import { NextResponse } from 'next/server';

import { listInboundWebhookActions } from '@/lib/actions/inboundWebhookActions';
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
} from 'server/src/lib/api/middleware/apiMiddleware';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';

export async function GET(request: Request) {
  try {
    const actions = await runWithApiKeyOrSession(request, () => listInboundWebhookActions());
    if (isServerActionErrorResult(actions)) {
      return createServerActionErrorResponse(actions);
    }
    return NextResponse.json({ data: actions });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
