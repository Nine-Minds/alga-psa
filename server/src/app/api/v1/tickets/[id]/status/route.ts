/**
 * Ticket Status API Route
 * PUT /api/v1/tickets/{id}/status - Update ticket status
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TicketController();

export async function PUT(request: Request) {
  try {
    return await controller.updateTicketStatus()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';