/**
 * Test authentication endpoint to debug API key auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from 'server/src/lib/api/middleware/apiAuthMiddleware';

function isTestAuthEndpointEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' || process.env.ENABLE_API_TEST_AUTH === 'true';
}

export async function GET(request: NextRequest) {
  if (!isTestAuthEndpointEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const handler = await withApiKeyAuth(async (req) => {
    return NextResponse.json({
      message: 'Authentication successful',
      context: {
        userId: req.context?.userId,
        tenant: req.context?.tenant,
        apiKeyId: req.context?.apiKeyId
      }
    });
  });

  return await handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
