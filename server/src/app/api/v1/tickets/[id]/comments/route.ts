/**
 * Ticket Comments API Routes
 * GET /api/v1/tickets/{id}/comments - Get ticket comments
 * POST /api/v1/tickets/{id}/comments - Add comment to ticket
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TicketController();

export async function GET(request: Request) {
  try {
    return await controller.getTicketComments()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await controller.addTicketComment()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';