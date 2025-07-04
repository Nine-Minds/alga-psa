/**
 * Project Tasks List API Routes
 * GET /api/v1/projects/{id}/tasks - List project tasks
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.getTasks();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';