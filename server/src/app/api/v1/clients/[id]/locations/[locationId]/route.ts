/**
 * Client Location by ID API Routes
 * PUT /api/v1/clients/{id}/locations/{locationId} - Update client location
 * DELETE /api/v1/clients/{id}/locations/{locationId} - Delete client location
 */

import { ApiClientController } from '@/lib/api/controllers/ApiClientController';

const controller = new ApiClientController();

export const PUT = controller.updateLocation();

export const DELETE = controller.deleteLocation();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
