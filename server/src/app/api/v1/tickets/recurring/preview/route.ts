/**
 * Recurring Ticket API Routes
 * POST /api/v1/tickets/recurring/preview - Preview the next 5 due dates of an unsaved schedule
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const POST = controller.preview();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
