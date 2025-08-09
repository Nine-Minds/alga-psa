/**
 * Ticket Status API Route
 * PUT /api/v1/tickets/{id}/status - Update ticket status
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PUT = controller.updateStatus();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';