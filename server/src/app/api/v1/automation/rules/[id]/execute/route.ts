/**
 * Automation Rule Execute API Route
 * POST /api/v1/automation/rules/{id}/execute - Execute automation rule manually
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function POST(request: NextRequest) {
  return controller.executeAutomationRule()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';