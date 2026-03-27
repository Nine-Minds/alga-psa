/**
 * Quotes API Route
 * GET /api/v1/quotes - List quotes
 * POST /api/v1/quotes - Create quote
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request) {
  return controller.list()(request as any);
}

export async function POST(request: Request) {
  return controller.create()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
