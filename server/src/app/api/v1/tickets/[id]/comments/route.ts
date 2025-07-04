/**
 * Ticket Comments API Routes
 * GET /api/v1/tickets/{id}/comments - Get ticket comments
 * POST /api/v1/tickets/{id}/comments - Add comment to ticket
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const GET = controller.getComments();
export const POST = controller.addComment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';