/**
 * Ticket Template API Routes
 * GET  /api/v1/tickets/templates - List ticket templates
 * POST /api/v1/tickets/templates - Create a ticket template
 */

import { ApiTicketTemplateController } from 'server/src/lib/api/controllers/ApiTicketTemplateController';

const controller = new ApiTicketTemplateController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
