/**
 * Automation Statistics API Route
 * GET /api/v1/automation/statistics - Get automation statistics and metrics
 */

import { NextRequest } from 'next/server';
import { ApiAutomationControllerV2 } from 'server/src/lib/api/controllers/ApiAutomationControllerV2';

const controller = new ApiAutomationControllerV2();

export async function GET(request: NextRequest) {
  return controller.getAutomationStatistics()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';