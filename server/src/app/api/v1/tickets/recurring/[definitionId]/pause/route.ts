/**
 * POST /api/v1/tickets/recurring/{definitionId}/pause - Pause a definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const POST = controller.pause();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
