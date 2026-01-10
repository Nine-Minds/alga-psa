/**
 * Products API Routes
 * GET /api/v1/products - List products
 * POST /api/v1/products - Create product
 */

import { ApiProductController } from '@/lib/api/controllers/ApiProductController';

const controller = new ApiProductController();

export const GET = controller.list();

export const POST = controller.create();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

