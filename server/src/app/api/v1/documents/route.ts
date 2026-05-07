import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async () => {
    return NextResponse.json({
      error: {
        code: 'NOT_FOUND',
        message: 'Endpoint not implemented',
      },
    }, { status: 404 });
  });

  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
