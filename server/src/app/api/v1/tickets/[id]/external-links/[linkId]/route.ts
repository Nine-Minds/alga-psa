/**
 * Ticket External Link Item API Routes
 * PATCH  /api/v1/tickets/{id}/external-links/{linkId}
 * DELETE /api/v1/tickets/{id}/external-links/{linkId}
 */
import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PATCH = controller.updateExternalLink();
export const DELETE = controller.deleteExternalLink();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
