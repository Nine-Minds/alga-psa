/**
 * Ticket Team Assignment API Route
 * PUT    /api/v1/tickets/{id}/team - Assign a team to a ticket
 * DELETE /api/v1/tickets/{id}/team - Remove the ticket's team assignment
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PUT = controller.assignTeam();
export const DELETE = controller.removeTeam();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
