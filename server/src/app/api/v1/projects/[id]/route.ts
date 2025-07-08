/**
 * Project Detail API Routes
 * GET /api/v1/projects/{id} - Get project details
 * PUT /api/v1/projects/{id} - Update project
 * DELETE /api/v1/projects/{id} - Delete project
 */

import { ApiProjectController } from '@/lib/api/controllers/ApiProjectController';

const controller = new ApiProjectController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';