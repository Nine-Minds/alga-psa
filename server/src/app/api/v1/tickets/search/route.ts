/**
 * Ticket Search API Route
 * GET /api/v1/tickets/search - Advanced ticket search
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';