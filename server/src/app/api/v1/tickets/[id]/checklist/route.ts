/**
 * Ticket Checklist API Routes
 * GET /api/v1/tickets/{id}/checklist - List checklist items
 * POST /api/v1/tickets/{id}/checklist - Add a manual checklist item
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getChecklist();
export const POST = controller.createChecklistItem();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
