/**
 * Ticket by ID API Routes
 * GET /api/v1/tickets/{id} - Get ticket by ID
 * PUT /api/v1/tickets/{id} - Update ticket
 * DELETE /api/v1/tickets/{id} - Delete ticket
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function GET(request: Request) {
  try {
    const controller = new TicketController();
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const controller = new TicketController();
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const controller = new TicketController();
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';