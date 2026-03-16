/**
 * KB Article Content Routes
 * GET /api/v1/kb-articles/:id/content - Get article content as readable text
 * PUT /api/v1/kb-articles/:id/content - Update article content
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const GET = controller.getContent();
export const PUT = controller.updateContent();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
