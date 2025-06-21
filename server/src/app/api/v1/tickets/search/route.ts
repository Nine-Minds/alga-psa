/**
 * Ticket Search API Route
 * GET /api/v1/tickets/search - Advanced ticket search
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TicketController();

export async function GET(request: Request) {
  try {
    return await controller.searchTickets()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';