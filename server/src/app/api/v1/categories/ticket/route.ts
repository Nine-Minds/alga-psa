/**
 * Ticket Categories API Route
 * GET /api/v1/categories/ticket - List ticket categories
 * POST /api/v1/categories/ticket - Create ticket category
 */

import { ApiCategoryControllerV2 } from 'server/src/lib/api/controllers/ApiCategoryControllerV2';

const controller = new ApiCategoryControllerV2();

export async function GET(request: Request) {
  return controller.listTicketCategories()(request as any);
}

export async function POST(request: Request) {
  return controller.createTicketCategory()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';