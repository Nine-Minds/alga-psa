/**
 * Project Task Comment Reactions API Route
 * POST /api/v1/projects/tasks/{taskId}/comments/{commentId}/reactions - Toggle an emoji reaction
 */

import { ApiProjectTaskCommentController } from '@/lib/api/controllers/ApiProjectTaskCommentController';

const controller = new ApiProjectTaskCommentController();

export const POST = controller.toggleReaction();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
