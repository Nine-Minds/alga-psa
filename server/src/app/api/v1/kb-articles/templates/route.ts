/**
 * KB Article Templates Route
 * GET /api/v1/kb-articles/templates - List article templates
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const GET = controller.getTemplates();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
