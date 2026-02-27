/**
 * Ticket Documents API Route
 * GET /api/v1/tickets/{id}/documents - Get ticket documents
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getDocuments();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
