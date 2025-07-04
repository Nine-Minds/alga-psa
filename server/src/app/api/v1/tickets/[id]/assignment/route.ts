/**
 * Ticket Assignment API Route
 * PUT /api/v1/tickets/{id}/assignment - Update ticket assignment
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const PUT = controller.updateAssignment();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';