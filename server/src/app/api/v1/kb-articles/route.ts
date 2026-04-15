/**
 * KB Articles API Routes
 * GET /api/v1/kb-articles - List articles
 * POST /api/v1/kb-articles - Create article
 */

import { ApiKbArticleController } from '@/lib/api/controllers/ApiKbArticleController';

const controller = new ApiKbArticleController();

export const GET = controller.list();
export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
