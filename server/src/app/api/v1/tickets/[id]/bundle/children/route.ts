/**
 * Ticket Bundle Children API Route
 * POST /api/v1/tickets/{id}/bundle/children - Add children to the bundle
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const POST = controller.addBundleChildren();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
