/**
 * Tickets API Routes
 * GET /api/v1/tickets - List tickets
 * POST /api/v1/tickets - Create ticket
 */

import { ApiTicketController } from '@/lib/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';