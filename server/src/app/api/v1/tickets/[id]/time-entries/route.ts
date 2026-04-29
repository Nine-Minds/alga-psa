/**
 * Ticket Time Entries API Route
 * GET /api/v1/tickets/{id}/time-entries - Get time entries logged on a ticket
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getTimeEntries();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
