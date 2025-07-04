/**
 * Users Activity API Route
 * GET /api/v1/users/activity - Get system-wide user activity
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.activity();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';