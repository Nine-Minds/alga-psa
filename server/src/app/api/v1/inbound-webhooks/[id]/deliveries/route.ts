/**
 * Inbound Webhook Deliveries API Route
 * GET /api/v1/inbound-webhooks/{id}/deliveries - List inbound webhook deliveries
 */

import { NextResponse } from 'next/server';

import { listInboundDeliveries } from '@/lib/actions/inboundWebhookActions';
import type { InboundWebhookDispatchStatus } from '@/lib/inboundWebhooks/types';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

type RouteContext = {
  params: Promise<{ id: string }>;
};

const VALID_DELIVERY_STATUSES = new Set<InboundWebhookDispatchStatus>([
  'pending',
  'dispatched',
  'duplicate',
  'failed',
]);

function parsePositiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const status = url.searchParams.get('status');
    const page = parsePositiveInt(url.searchParams.get('page'), 1);
    const limit = parsePositiveInt(url.searchParams.get('limit'), 25);

    const deliveries = await listInboundDeliveries(
      {
        inboundWebhookId: id,
        status: status && VALID_DELIVERY_STATUSES.has(status as InboundWebhookDispatchStatus)
          ? (status as InboundWebhookDispatchStatus)
          : undefined,
        dateFrom: url.searchParams.get('date_from') ?? url.searchParams.get('dateFrom') ?? undefined,
        dateTo: url.searchParams.get('date_to') ?? url.searchParams.get('dateTo') ?? undefined,
      },
      page,
      limit,
    );

    return NextResponse.json({
      data: deliveries.data,
      meta: {
        page: deliveries.page,
        limit: deliveries.limit,
        total: deliveries.total,
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
