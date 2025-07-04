/**
 * Test authentication endpoint to debug API key auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from 'server/src/lib/api/middleware/apiAuthMiddleware';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: NextRequest) {
  const handler = withApiKeyAuth(async (req) => {
    console.log('Auth successful, context:', req.context);
    return NextResponse.json({ 
      message: 'Authentication successful',
      context: req.context 
    });
  });
  
  return await handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';