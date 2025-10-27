/**
 * Automation Statistics API Route
 * GET /api/v1/automation/statistics - Get automation statistics and metrics
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationStatistics()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';