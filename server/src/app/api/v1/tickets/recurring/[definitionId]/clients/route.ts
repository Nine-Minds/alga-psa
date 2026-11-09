/**
 * POST /api/v1/tickets/recurring/{definitionId}/clients - Add clients to a definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const POST = controller.addClients();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
