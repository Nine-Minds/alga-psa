/**
 * Project Tasks List API Routes
 * GET /api/v1/projects/{id}/tasks - List project tasks
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getTasks();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';