/**
 * Product by ID API Routes
 * GET /api/v1/products/{id} - Retrieve product details
 * PUT /api/v1/products/{id} - Update product
 * DELETE /api/v1/products/{id} - Remove product
 */

import { ApiProductController } from '@/lib/api/controllers/ApiProductController';

const controller = new ApiProductController();

// The controller registers under the 'service' RBAC resource, so the base
// controller's URL-fallback ID parsing (which looks for /services/) cannot
// find the ID in /products/{id} — params must be attached explicitly.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getById()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.update()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.delete()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
