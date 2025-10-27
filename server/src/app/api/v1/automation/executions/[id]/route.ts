/**
 * Automation Execution Detail API Routes
 * GET /api/v1/automation/executions/{id} - Get automation execution details
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationExecution()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';