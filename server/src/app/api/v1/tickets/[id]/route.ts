/**
 * Ticket by ID API Routes
 * GET /api/v1/tickets/{id} - Get ticket by ID
 * PUT /api/v1/tickets/{id} - Update ticket
 * DELETE /api/v1/tickets/{id} - Delete ticket
 */

import { ApiTicketController } from '@product/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';