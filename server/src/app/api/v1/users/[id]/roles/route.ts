/**
 * User Roles API Route
 * GET /api/v1/users/[id]/roles - Get user roles
 * PUT /api/v1/users/[id]/roles - Assign roles to user
 * DELETE /api/v1/users/[id]/roles - Remove roles from user
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.getRoles();
// Note: PUT and DELETE for role assignment would need separate methods in the controller
// For now, these endpoints may need additional implementation

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';