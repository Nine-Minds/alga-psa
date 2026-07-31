/**
 * Ticket Additional Agent API Route
 * DELETE /api/v1/tickets/{id}/agents/{userId} - Remove an additional agent
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const DELETE = controller.removeAgent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
