/**
 * Automation Templates API Routes
 * GET /api/v1/automation/templates - List automation templates
 * POST /api/v1/automation/templates - Create template from automation rule
 */

import { NextRequest } from 'next/server';
import { ApiAutomationController } from '@product/api/controllers/ApiAutomationController';

const controller = new ApiAutomationController();

export async function GET(request: NextRequest) {
  return controller.listAutomationTemplates()(request);
}

export async function POST(request: NextRequest) {
  return controller.createAutomationTemplate()(request);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';