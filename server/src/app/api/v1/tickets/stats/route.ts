/**
 * Ticket Statistics API Route
 * GET /api/v1/tickets/stats - Get ticket statistics
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TicketController();

export async function GET(request: Request) {
  try {
    return await controller.getTicketStats()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';