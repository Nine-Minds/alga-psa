/**
 * Automation Rules API Routes
 * GET /api/v1/automation/rules - List automation rules
 * POST /api/v1/automation/rules - Create new automation rule
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new AutomationController();

export async function GET(request: Request) {
  try {
    return await controller.listAutomationRules()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.createAutomationRule()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';