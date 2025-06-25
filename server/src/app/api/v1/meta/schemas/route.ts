/**
 * GET /api/v1/meta/schemas
 * List all API schemas and data models
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  return controller.getSchemas(request);
}