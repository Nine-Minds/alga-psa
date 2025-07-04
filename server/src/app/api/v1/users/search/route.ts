/**
 * Users Search API Route
 * GET /api/v1/users/search - Search users
 */

import { ApiUserControllerV2 } from '@/lib/api/controllers/ApiUserControllerV2';

const controller = new ApiUserControllerV2();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';