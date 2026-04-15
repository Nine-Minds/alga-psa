/**
 * KB Article Archive Route
 * POST /api/v1/kb-articles/:id/archive
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const POST = controller.archive();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
