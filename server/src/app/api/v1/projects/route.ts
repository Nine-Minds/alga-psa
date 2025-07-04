/**
 * Projects API Routes
 * GET /api/v1/projects - List projects
 * POST /api/v1/projects - Create new project
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';