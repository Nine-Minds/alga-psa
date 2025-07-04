/**
 * User Permissions API Route
 * GET /api/v1/users/[id]/permissions - Get user effective permissions
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.getPermissions();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';