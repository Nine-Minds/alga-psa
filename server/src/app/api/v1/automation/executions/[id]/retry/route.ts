/**
 * Automation Execution Retry API Route
 * POST /api/v1/automation/executions/{id}/retry - Retry failed automation execution
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function POST(request: NextRequest) {
  return controller.retryAutomationExecution()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';