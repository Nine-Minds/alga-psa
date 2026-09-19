/**
 * Ticket Document Thumbnail API Route
 * GET /api/v1/tickets/{id}/documents/{documentId}/thumbnail - Serve the cached 200x200 thumbnail image
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.downloadDocumentVariant('thumbnail');

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
