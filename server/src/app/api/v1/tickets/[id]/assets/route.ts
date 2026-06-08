/**
 * Ticket Assets API Route
 * GET /api/v1/tickets/{id}/assets - List assets linked to a ticket
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getAssets();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
