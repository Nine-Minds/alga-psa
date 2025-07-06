/**
 * Project Task Detail API Routes
 * GET /api/v1/projects/tasks/{taskId} - Get project task
 * PUT /api/v1/projects/tasks/{taskId} - Update project task
 * DELETE /api/v1/projects/tasks/{taskId} - Delete project task
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.getTask();
export const PUT = controller.updateTask();
export const DELETE = controller.deleteTask();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';