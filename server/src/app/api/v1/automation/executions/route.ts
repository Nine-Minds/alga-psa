/**
 * Automation Executions API Routes
 * GET /api/v1/automation/executions - List automation executions
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.listAutomationExecutions()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';