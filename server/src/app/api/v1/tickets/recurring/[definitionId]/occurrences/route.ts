/**
 * GET /api/v1/tickets/recurring/{definitionId}/occurrences - Occurrence history
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const GET = controller.occurrences();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
