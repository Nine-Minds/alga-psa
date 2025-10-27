/**
 * Automation Template Detail API Routes
 * GET /api/v1/automation/templates/{id} - Get automation template details
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationTemplate()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';