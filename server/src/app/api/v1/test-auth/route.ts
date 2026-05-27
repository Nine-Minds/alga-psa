/**
 * Test authentication endpoint to debug API key auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from 'server/src/lib/api/middleware/apiAuthMiddleware';

export async function GET(request: NextRequest) {
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
