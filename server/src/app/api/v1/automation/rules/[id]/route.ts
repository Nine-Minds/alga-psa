/**
 * Automation Rule Detail API Routes
 * GET /api/v1/automation/rules/{id} - Get automation rule details
 * PUT /api/v1/automation/rules/{id} - Update automation rule
 * DELETE /api/v1/automation/rules/{id} - Delete automation rule
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.getAutomationRule()(request);
}

export async function PUT(request: NextRequest) {
  return controller.updateAutomationRule()(request);
}

export async function DELETE(request: NextRequest) {
  return controller.deleteAutomationRule()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';