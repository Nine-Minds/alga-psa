/**
 * Financial Credits API Route
 * GET /api/v1/financial/credits - List company credits
 */

import { ApiFinancialController } from 'server/src/lib/api/controllers/ApiFinancialController';

export async function GET(request: Request) {
  const controller = new ApiFinancialController();
  return await controller.listCredits()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';