/**
 * Ticket Project Link API Routes
 * GET /api/v1/tickets/{id}/project-links - The project tasks the ticket is linked to, with each task's status
 */
import { ApiProjectController } from 'server/src/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getTicketProjectLinks();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
