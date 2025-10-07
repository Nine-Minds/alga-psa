/**
 * Clients API Routes
 * GET /api/v1/clients - List clients
 * POST /api/v1/clients - Create client
 *
 * This is the new endpoint for client management.
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.list();

export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
