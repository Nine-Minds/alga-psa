/**
 * Automation Performance API Route
 * GET /api/v1/automation/performance - Get automation performance metrics
 */

import { NextRequest } from 'next/server';
import { ApiAutomationControllerV2 } from 'server/src/lib/api/controllers/ApiAutomationControllerV2';

const controller = new ApiAutomationControllerV2();

export async function GET(request: NextRequest) {
  return controller.getAutomationPerformance()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';