/**
 * Tickets API Routes
 * GET /api/v1/tickets - List tickets
 * POST /api/v1/tickets - Create ticket
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';