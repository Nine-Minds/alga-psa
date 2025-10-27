/**
 * Automation Metadata API Route
 * GET /api/v1/automation/meta - Get automation rule types and categories
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationMeta()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';