/**
 * Create Ticket from Asset API Route
 * POST /api/v1/tickets/from-asset - Create ticket from asset
 */

import { NextRequest, NextResponse } from 'next/server';
import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';

const controller = new ApiTicketController();

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async () => {
    return NextResponse.json({
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
    }, { status: 405 });
  });

  return handler(request);
}

export const POST = controller.createFromAsset();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';