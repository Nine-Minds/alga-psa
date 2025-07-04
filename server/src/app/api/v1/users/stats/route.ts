/**
 * Users Statistics API Route
 * GET /api/v1/users/stats - Get user statistics
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.stats();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';