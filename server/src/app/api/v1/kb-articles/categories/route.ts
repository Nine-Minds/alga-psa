/**
 * KB Article Categories Route
 * GET /api/v1/kb-articles/categories - List available categories
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const GET = controller.getCategories();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
