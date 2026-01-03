/**
 * Product by ID API Routes
 * GET /api/v1/products/{id} - Retrieve product details
 * PUT /api/v1/products/{id} - Update product
 * DELETE /api/v1/products/{id} - Remove product
 */

import { ApiProductController } from '@/lib/api/controllers/ApiProductController';

const controller = new ApiProductController();

export const GET = controller.getById();

export const PUT = controller.update();

export const DELETE = controller.delete();

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

