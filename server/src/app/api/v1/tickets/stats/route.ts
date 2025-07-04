/**
 * Ticket Statistics API Route
 * GET /api/v1/tickets/stats - Get ticket statistics
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';