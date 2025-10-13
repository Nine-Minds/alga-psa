/**
 * Contract Lines Bulk Operations API Route
 * POST /api/v1/contract-lines/bulk - Bulk operations on contract lines
 */

import { ApiContractLineController } from 'server/src/lib/api/controllers/ApiContractLineController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ApiContractLineController();

export async function POST(request: Request) {
  try {
    return await controller.bulkCreatePlans()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.bulkUpdatePlans()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.bulkDeletePlans()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';