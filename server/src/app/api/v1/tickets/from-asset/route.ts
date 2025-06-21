/**
 * Create Ticket from Asset API Route
 * POST /api/v1/tickets/from-asset - Create ticket from asset
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new TicketController();

export async function POST(request: Request) {
  try {
    return await controller.createTicketFromAsset()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';