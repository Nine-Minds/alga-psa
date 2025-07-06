/**
 * Automation Rules Bulk Execute API Route
 * POST /api/v1/automation/rules/bulk-execute - Bulk execute automation rules
 */

import { NextRequest } from 'next/server';
import { ApiAutomationControllerV2 } from 'server/src/lib/api/controllers/ApiAutomationControllerV2';

const controller = new ApiAutomationControllerV2();

export async function POST(request: NextRequest) {
  return controller.bulkExecuteRules()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';