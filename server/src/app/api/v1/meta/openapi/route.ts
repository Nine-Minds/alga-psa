/**
 * GET /api/v1/meta/openapi
 * Generate OpenAPI 3.0 specification for the entire API
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  return controller.getOpenApiSpec(request);
}