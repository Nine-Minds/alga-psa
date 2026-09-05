/**
 * Ticket Checklist Item API Route
 * PATCH /api/v1/tickets/{id}/checklist/{itemId} - Complete or uncomplete item
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PATCH = controller.updateChecklistItemCompletion();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
