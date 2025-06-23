/**
 * Automation Rules API Routes
 * GET /api/v1/automation/rules - List automation rules
 * POST /api/v1/automation/rules - Create new automation rule
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.listAutomationRules()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.createAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';