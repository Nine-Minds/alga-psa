/**
 * Project Task Comment by ID API Routes
 * PUT    /api/v1/projects/tasks/{taskId}/comments/{commentId} - Edit a task comment
 * DELETE /api/v1/projects/tasks/{taskId}/comments/{commentId} - Delete a task comment
 */

import { ApiProjectTaskCommentController } from '@/lib/api/controllers/ApiProjectTaskCommentController';

const controller = new ApiProjectTaskCommentController();

export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
