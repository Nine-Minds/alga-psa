/**
 * PUT    /api/v1/tickets/recurring/{definitionId}/clients/{clientId} - Replace a client's overrides
 * DELETE /api/v1/tickets/recurring/{definitionId}/clients/{clientId} - Remove a client
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const PUT = controller.updateClient();
export const DELETE = controller.removeClient();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
