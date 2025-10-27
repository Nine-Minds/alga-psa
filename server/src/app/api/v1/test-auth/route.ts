/**
 * Test authentication endpoint to debug API key auth
 */

import { NextRequest, NextResponse } from 'next/server';
import { withApiKeyAuth } from '@product/api/middleware/apiAuthMiddleware';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async (req) => {
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