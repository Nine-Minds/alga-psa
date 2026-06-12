/**
 * Ticket Asset Link API Route
 * DELETE /api/v1/tickets/{id}/assets/{assetId} - Unlink an asset from a ticket
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const DELETE = controller.unlinkAsset();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
