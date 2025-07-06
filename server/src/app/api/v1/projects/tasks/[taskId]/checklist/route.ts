/**
 * Project Task Checklist API Routes
 * GET /api/v1/projects/tasks/{taskId}/checklist - Get task checklist items
 * POST /api/v1/projects/tasks/{taskId}/checklist - Create checklist item
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.getTaskChecklist();
export const POST = controller.createChecklistItem();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';