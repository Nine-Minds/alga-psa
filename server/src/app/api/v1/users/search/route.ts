/**
 * Users Search API Route
 * GET /api/v1/users/search - Search users
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';

const controller = new ApiUserController();

export const GET = controller.search();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';