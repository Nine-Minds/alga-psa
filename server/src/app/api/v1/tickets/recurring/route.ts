/**
 * Recurring Ticket API Routes
 * GET  /api/v1/tickets/recurring - List recurring ticket definitions
 * POST /api/v1/tickets/recurring - Create a recurring ticket definition
 */

import { ApiRecurringTicketController } from 'server/src/lib/api/controllers/ApiRecurringTicketController';

const controller = new ApiRecurringTicketController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
