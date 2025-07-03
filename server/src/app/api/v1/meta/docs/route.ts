/**
 * GET /api/v1/meta/docs
 * Serve interactive API documentation (Swagger UI)
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  return controller.getDocs(request, searchParams);
}