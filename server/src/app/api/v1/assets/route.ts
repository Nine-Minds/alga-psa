/**
 * assets API Routes
 * Path: /api/v1/assets
 */

import { NextRequest } from 'next/server';
import { ApiAssetController } from '@/lib/api/controllers/ApiAssetController';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';

const controller = new ApiAssetController();

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(async (req) => controller.list(req as any));
  return handler(request);
}

export async function POST(request: NextRequest) {
  const handler = await withApiKeyAuth(async (req) => controller.create(req as any));
  return handler(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
