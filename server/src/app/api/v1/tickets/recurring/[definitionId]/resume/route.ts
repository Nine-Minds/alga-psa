/**
 * POST /api/v1/tickets/recurring/{definitionId}/resume - Resume a definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const POST = controller.resume();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
