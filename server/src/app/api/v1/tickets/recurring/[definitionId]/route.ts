/**
 * Recurring Ticket API Routes
 * GET    /api/v1/tickets/recurring/{definitionId} - Get one definition
 * PUT    /api/v1/tickets/recurring/{definitionId} - Replace a definition
 * DELETE /api/v1/tickets/recurring/{definitionId} - Archive a definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
