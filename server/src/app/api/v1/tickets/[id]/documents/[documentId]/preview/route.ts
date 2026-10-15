/**
 * Ticket Document Preview API Route
 * GET /api/v1/tickets/{id}/documents/{documentId}/preview - Serve the cached 800x600 preview image
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.downloadDocumentVariant('preview');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
