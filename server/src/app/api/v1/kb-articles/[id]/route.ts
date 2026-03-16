/**
 * KB Article by ID API Routes
 * GET /api/v1/kb-articles/:id - Get article
 * PUT /api/v1/kb-articles/:id - Update article
 * DELETE /api/v1/kb-articles/:id - Delete article
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const GET = controller.getById();
export const PUT = controller.update();
export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
