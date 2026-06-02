/**
 * Ticket Bundle Child API Route
 * DELETE /api/v1/tickets/{id}/bundle/children/{childId} - Remove a child from the bundle
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const DELETE = controller.removeBundleChild();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
