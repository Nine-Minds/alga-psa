/**
 * Contact Avatar API Routes
 * POST /api/v1/contacts/{id}/avatar - Upload contact avatar (multipart field `avatar`)
 * DELETE /api/v1/contacts/{id}/avatar - Delete contact avatar
 */

import { ApiContactController } from 'server/src/lib/api/controllers/ApiContactController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiContactController();
    const req = request as any;
    req.params = params;
    return await controller.uploadAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const controller = new ApiContactController();
    const req = request as any;
    req.params = params;
    return await controller.deleteAvatar()(req);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
