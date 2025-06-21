/**
 * Automation Rules Bulk Status Update API Route
 * POST /api/v1/automation/rules/bulk-status - Bulk update automation rule status
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function POST(request: Request) {
  try {
    return await controller.bulkUpdateStatus()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';