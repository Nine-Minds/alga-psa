/**
 * Automation Executions API Routes
 * GET /api/v1/automation/executions - List automation executions
 */

import { NextRequest } from 'next/server';
import { ApiAutomationControllerV2 } from 'server/src/lib/api/controllers/ApiAutomationControllerV2';

const controller = new ApiAutomationControllerV2();

export async function GET(request: NextRequest) {
  return controller.listAutomationExecutions()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';