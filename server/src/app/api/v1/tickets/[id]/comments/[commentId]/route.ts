/**
 * Individual Ticket Comment API Routes
 * PUT /api/v1/tickets/{id}/comments/{commentId} - Update a comment
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PUT = controller.updateComment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
