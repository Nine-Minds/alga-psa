/**
 * Automation Performance API Route
 * GET /api/v1/automation/performance - Get automation performance metrics
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationPerformance()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';