/**
 * Service by ID API Routes
 * GET /api/v1/services/{id} - Retrieve service details
 * PUT /api/v1/services/{id} - Update service
 * DELETE /api/v1/services/{id} - Remove service
 */

import { ApiServiceController } from '@/lib/api/controllers/ApiServiceController';

const controller = new ApiServiceController();

export const GET = controller.getById();

export const PUT = controller.update();

export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
