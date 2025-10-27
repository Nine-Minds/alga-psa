/**
 * Contact by ID API Routes
 * GET /api/v1/contacts/{id} - Get contact by ID
 * PUT /api/v1/contacts/{id} - Update contact
 * DELETE /api/v1/contacts/{id} - Delete contact
 */

import { ApiContactController } from '@product/api/controllers/ApiContactController';
import { handleApiError } from '@product/api/middleware/apiMiddleware';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiContactController();
    const req = request as any;
    req.params = params;
    return await controller.getById()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiContactController();
    const req = request as any;
    req.params = params;
    return await controller.update()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiContactController();
    const req = request as any;
    req.params = params;
    return await controller.delete()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';