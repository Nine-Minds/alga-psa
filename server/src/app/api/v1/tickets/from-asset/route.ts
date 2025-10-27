/**
 * Create Ticket from Asset API Route
 * POST /api/v1/tickets/from-asset - Create ticket from asset
 */

import { ApiTicketController } from '@product/api/controllers/ApiTicketController';

const controller = new ApiTicketController();

export const POST = controller.createFromAsset();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';