/**
 * Create Ticket from Asset API Route
 * POST /api/v1/tickets/from-asset - Create ticket from asset
 */

import { TicketController } from 'server/src/lib/api/controllers/TicketController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request) {
  try {
    const controller = new TicketController();
    return await controller.createTicketFromAsset()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';