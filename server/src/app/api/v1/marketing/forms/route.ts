/**
 * GET /api/v1/marketing/forms - List capture forms
 * POST /api/v1/marketing/forms - Create capture form
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request) {
  return controller.listForms()(request as any);
}

export async function POST(request: Request) {
  return controller.createForm()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
