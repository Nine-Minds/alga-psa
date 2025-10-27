/**
 * Automation Template Use API Route
 * POST /api/v1/automation/templates/{id}/use - Create automation rule from template
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function POST(request: NextRequest) {
  return controller.useAutomationTemplate()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';