/**
 * Users Activity API Route
 * GET /api/v1/users/activity - Get system-wide user activity
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';

const controller = new ApiUserController();

export const GET = controller.activity();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';