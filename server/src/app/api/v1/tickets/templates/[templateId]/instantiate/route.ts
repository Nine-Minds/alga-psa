/**
 * Ticket Template API Routes
 * POST /api/v1/tickets/templates/{templateId}/instantiate - Create a ticket from the template
 */

import { ApiTicketTemplateController } from 'server/src/lib/api/controllers/ApiTicketTemplateController';

const controller = new ApiTicketTemplateController();

export const POST = controller.instantiate();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
