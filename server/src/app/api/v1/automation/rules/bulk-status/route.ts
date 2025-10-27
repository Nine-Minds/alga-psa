/**
 * Automation Rules Bulk Status Update API Route
 * POST /api/v1/automation/rules/bulk-status - Bulk update automation rule status
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function POST(request: NextRequest) {
  return controller.bulkUpdateStatus()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';