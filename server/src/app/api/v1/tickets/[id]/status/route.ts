/**
 * Ticket Status API Route
 * PUT /api/v1/tickets/{id}/status - Update ticket status
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const PUT = controller.updateStatus();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';