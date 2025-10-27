/**
 * Ticket Search API Route
 * GET /api/v1/tickets/search - Advanced ticket search
 */

import { ApiTicketController } from '@product/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';