/**
 * Automation Templates API Routes
 * GET /api/v1/automation/templates - List automation templates
 * POST /api/v1/automation/templates - Create template from automation rule
 */

import { AutomationController } from 'server/src/lib/api/controllers/AutomationController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.listAutomationTemplates()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const controller = new AutomationController();
    return await controller.createAutomationTemplate()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';