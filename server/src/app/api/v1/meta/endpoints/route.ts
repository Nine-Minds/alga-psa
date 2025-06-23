/**
 * GET /api/v1/meta/endpoints
 * List all available API endpoints with metadata
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  return controller.getEndpoints(request);
}