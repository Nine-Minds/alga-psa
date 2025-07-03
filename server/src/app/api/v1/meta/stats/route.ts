/**
 * GET /api/v1/meta/stats
 * Get API usage statistics and metrics
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  return controller.getStats(request, searchParams);
}