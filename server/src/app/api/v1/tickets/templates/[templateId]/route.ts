/**
 * Ticket Template API Routes
 * GET    /api/v1/tickets/templates/{templateId} - Get one ticket template with its checklist
 * PUT    /api/v1/tickets/templates/{templateId} - Replace a ticket template (and activate/deactivate it)
 * DELETE /api/v1/tickets/templates/{templateId} - Delete a ticket template
 */

import { ApiTicketTemplateController } from 'server/src/lib/api/controllers/ApiTicketTemplateController';

const controller = new ApiTicketTemplateController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
