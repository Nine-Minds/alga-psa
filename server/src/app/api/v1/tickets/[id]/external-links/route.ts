/**
 * Ticket External Link API Routes
 * GET    /api/v1/tickets/{id}/external-links - List external links
 * POST   /api/v1/tickets/{id}/external-links - Add a ticket-level external link
 */
import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getExternalLinks();
export const POST = controller.createExternalLink();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
