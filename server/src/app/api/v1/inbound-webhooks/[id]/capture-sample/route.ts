/**
 * Inbound Webhook Sample Capture API Routes
 * POST /api/v1/inbound-webhooks/{id}/capture-sample - Enable sample capture
 * DELETE /api/v1/inbound-webhooks/{id}/capture-sample - Clear captured sample
 */

import { NextResponse } from 'next/server';

import { captureSamplePayload, clearSamplePayload } from '@/lib/actions/inboundWebhookActions';
import {
  createServerActionErrorResponse,
  handleApiError,
  isServerActionErrorResult,
} from 'server/src/lib/api/middleware/apiMiddleware';
import { runWithApiKeyOrSession } from 'server/src/lib/api/middleware/runWithApiKeyOrSession';

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await runWithApiKeyOrSession(request, () => captureSamplePayload(id));
    if (isServerActionErrorResult(webhook)) {
      return createServerActionErrorResponse(webhook);
    }
    return NextResponse.json({ data: webhook });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const webhook = await runWithApiKeyOrSession(request, () => clearSamplePayload(id));
    if (isServerActionErrorResult(webhook)) {
      return createServerActionErrorResponse(webhook);
    }
    return NextResponse.json({ data: webhook });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
