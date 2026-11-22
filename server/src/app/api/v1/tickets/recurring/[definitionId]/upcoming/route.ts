/**
 * GET /api/v1/tickets/recurring/{definitionId}/upcoming - Next 5 due dates of a saved definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const GET = controller.upcoming();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
