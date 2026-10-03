/**
 * Project Task Checklist Item API Routes
 * PUT /api/v1/projects/tasks/{taskId}/checklist/{itemId} - Update checklist item (e.g. mark done)
 * DELETE /api/v1/projects/tasks/{taskId}/checklist/{itemId} - Delete checklist item
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const PUT = controller.updateChecklistItem();
export const DELETE = controller.deleteChecklistItem();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
