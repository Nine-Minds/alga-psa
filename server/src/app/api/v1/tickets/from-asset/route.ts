/**
 * Create Ticket from Asset API Route
 * POST /api/v1/tickets/from-asset - Create ticket from asset
 */

import { ApiTicketControllerV2 } from 'server/src/lib/api/controllers/ApiTicketControllerV2';

const controller = new ApiTicketControllerV2();

export const POST = controller.createFromAsset();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';