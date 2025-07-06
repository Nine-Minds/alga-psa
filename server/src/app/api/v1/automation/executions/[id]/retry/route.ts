/**
 * Automation Execution Retry API Route
 * POST /api/v1/automation/executions/{id}/retry - Retry failed automation execution
 */

import { NextRequest } from 'next/server';
import { ApiAutomationControllerV2 } from 'server/src/lib/api/controllers/ApiAutomationControllerV2';

const controller = new ApiAutomationControllerV2();

export async function POST(request: NextRequest) {
  return controller.retryAutomationExecution()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';