/**
 * Ticket Bundle Promote API Route
 * POST /api/v1/tickets/{id}/bundle/promote - Promote a child to be the new master
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const POST = controller.promoteBundleMaster();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
