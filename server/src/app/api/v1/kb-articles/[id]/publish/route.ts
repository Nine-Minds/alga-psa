/**
 * KB Article Publish Route
 * POST /api/v1/kb-articles/:id/publish
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const POST = controller.publish();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
