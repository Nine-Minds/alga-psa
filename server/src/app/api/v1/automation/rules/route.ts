/**
 * Automation Rules API Routes
 * GET /api/v1/automation/rules - List automation rules
 * POST /api/v1/automation/rules - Create new automation rule
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.listAutomationRules()(request);
}

export async function POST(request: NextRequest) {
  return controller.createAutomationRule()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';