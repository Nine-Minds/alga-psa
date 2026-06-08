/**
 * Ticket Assets API Route
 * GET  /api/v1/tickets/{id}/assets - List assets linked to a ticket
 * POST /api/v1/tickets/{id}/assets - Link an asset to a ticket
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getAssets();
export const POST = controller.linkAsset();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
