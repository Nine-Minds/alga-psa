/**
 * Ticket By External Link Lookup
 * GET /api/v1/tickets/by-external-link?system=…&external_id=…&external_parent_id=…
 *
 * Returns the ticket summary plus the matching link, or 404 when no ticket
 * carries that external record.
 */
import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.findByExternalLink();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
