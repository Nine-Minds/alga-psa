/**
 * POST /api/v1/tickets/recurring/{definitionId}/clients/{clientId}/pause - Pause one client
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const POST = controller.pauseClient();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
