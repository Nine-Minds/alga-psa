/**
 * Automation Rules Bulk Execute API Route
 * POST /api/v1/automation/rules/bulk-execute - Bulk execute automation rules
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function POST(request: NextRequest) {
  return controller.bulkExecuteRules()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';