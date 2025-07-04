/**
 * User by ID API Route
 * GET /api/v1/users/[id] - Get user by ID
 * PUT /api/v1/users/[id] - Update user
 * DELETE /api/v1/users/[id] - Delete user
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';