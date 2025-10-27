/**
 * Ticket Comments API Routes
 * GET /api/v1/tickets/{id}/comments - Get ticket comments
 * POST /api/v1/tickets/{id}/comments - Add comment to ticket
 */

import { ApiTicketController } from '@product/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getComments();
export const POST = controller.addComment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';