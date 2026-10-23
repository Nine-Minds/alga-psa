/**
 * Scheduled Ticket Comment API Route
 * DELETE /api/v1/tickets/{id}/comments/{commentId}/schedule - Cancel a scheduled comment before it publishes
 */
import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const DELETE = controller.cancelScheduledComment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
