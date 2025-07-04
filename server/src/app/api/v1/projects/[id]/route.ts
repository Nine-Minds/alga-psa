/**
 * Project Detail API Routes
 * GET /api/v1/projects/{id} - Get project details
 * PUT /api/v1/projects/{id} - Update project
 * DELETE /api/v1/projects/{id} - Delete project
 */

import { ApiProjectControllerV2 } from '@/lib/api/controllers/ApiProjectControllerV2';

const controller = new ApiProjectControllerV2();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';