/**
 * Project Task Comments API Routes
 * GET  /api/v1/projects/tasks/{taskId}/comments - List task comments
 * POST /api/v1/projects/tasks/{taskId}/comments - Add a task comment or reply
 */

import { ApiProjectTaskCommentController } from '@/lib/api/controllers/ApiProjectTaskCommentController';

const controller = new ApiProjectTaskCommentController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
