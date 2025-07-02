/**
 * Tags Analytics API Route
 * GET /api/v1/tags/analytics - Get tag analytics
 */

import { TagController } from 'server/src/lib/api/controllers/TagController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TagController();

export async function GET(request: Request) {
  try {
    return await controller.getTagAnalytics()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';