/**
 * Ticket Bundle API Routes
 * GET    /api/v1/tickets/{id}/bundle - Get bundle membership for a ticket
 * POST   /api/v1/tickets/{id}/bundle - Create a bundle with {id} as master
 * DELETE /api/v1/tickets/{id}/bundle - Unbundle the master {id}
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getBundle();
export const POST = controller.bundleTickets();
export const DELETE = controller.unbundleMaster();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
