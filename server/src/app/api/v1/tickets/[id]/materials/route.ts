/**
 * Ticket Materials API Route
 * GET /api/v1/tickets/{id}/materials - Get ticket materials
 * POST /api/v1/tickets/{id}/materials - Add a material to a ticket
 */

import { ApiTicketController } from 'server/src/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.getMaterials();
export const POST = controller.addMaterial();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
