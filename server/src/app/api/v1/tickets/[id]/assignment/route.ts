/**
 * Ticket Assignment API Route
 * PUT /api/v1/tickets/{id}/assignment - Update ticket assignment
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const PUT = controller.updateAssignment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';