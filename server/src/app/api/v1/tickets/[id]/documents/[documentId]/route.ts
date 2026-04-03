/**
 * Ticket Document Download API Route
 * GET /api/v1/tickets/{id}/documents/{documentId} - Download a ticket document
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.downloadDocument();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
