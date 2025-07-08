/**
 * Users API Route
 * GET /api/v1/users - List users
 * POST /api/v1/users - Create user
 */

import { ApiUserController } from '@/lib/api/controllers/ApiUserController';

const controller = new ApiUserController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';