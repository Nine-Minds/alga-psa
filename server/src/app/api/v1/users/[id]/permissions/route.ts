/**
 * User Permissions API Route
 * GET /api/v1/users/[id]/permissions - Get user effective permissions
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';

const controller = new ApiUserController();

export const GET = controller.getPermissions();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';