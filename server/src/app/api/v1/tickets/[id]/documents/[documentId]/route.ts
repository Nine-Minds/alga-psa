/**
 * Ticket Document API Routes
 * GET /api/v1/tickets/{id}/documents/{documentId} - Download a ticket document
 * DELETE /api/v1/tickets/{id}/documents/{documentId} - Delete a ticket document
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.downloadDocument();
export const DELETE = controller.deleteDocument();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
