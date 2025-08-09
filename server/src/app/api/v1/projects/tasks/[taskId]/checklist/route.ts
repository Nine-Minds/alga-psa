/**
 * Project Task Checklist API Routes
 * GET /api/v1/projects/tasks/{taskId}/checklist - Get task checklist items
 * POST /api/v1/projects/tasks/{taskId}/checklist - Create checklist item
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getTaskChecklist();
export const POST = controller.createChecklistItem();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';