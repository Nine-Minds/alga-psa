/**
 * Ticket Statistics API Route
 * GET /api/v1/tickets/stats - Get ticket statistics
 */

import { ApiTicketController } from '@product/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';