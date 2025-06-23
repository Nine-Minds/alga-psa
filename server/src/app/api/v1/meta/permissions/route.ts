/**
 * GET /api/v1/meta/permissions
 * List all API permissions and access requirements
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  return controller.getPermissions(request);
}