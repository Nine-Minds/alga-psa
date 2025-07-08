/**
 * Projects API Routes
 * GET /api/v1/projects - List projects
 * POST /api/v1/projects - Create new project
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';