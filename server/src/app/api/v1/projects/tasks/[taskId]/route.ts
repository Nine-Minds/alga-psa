/**
 * Project Task Detail API Routes
 * GET /api/v1/projects/tasks/{taskId} - Get project task
 * PUT /api/v1/projects/tasks/{taskId} - Update project task
 * DELETE /api/v1/projects/tasks/{taskId} - Delete project task
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getTask();
export const PUT = controller.updateTask();
export const DELETE = controller.deleteTask();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';