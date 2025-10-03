/**
 * Client by ID API Routes
 * GET /api/v1/clients/{id} - Get client by ID
 * PUT /api/v1/clients/{id} - Update client
 * DELETE /api/v1/clients/{id} - Delete client
 *
 * This is the new endpoint for client management.
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const GET = controller.getById();

export const PUT = controller.update();

export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
