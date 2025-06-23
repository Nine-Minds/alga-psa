/**
 * GET /api/v1/meta/health
 * Get API health status and service availability
 */

import { NextRequest } from 'next/server';
import { MetadataController } from 'server/src/lib/api/controllers/MetadataController';

const controller = new MetadataController();

export async function GET(request: NextRequest) {
  return controller.getHealth(request);
}