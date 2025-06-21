/**
 * Contact by ID API Routes
 * GET /api/v1/contacts/{id} - Get contact by ID
 * PUT /api/v1/contacts/{id} - Update contact
 * DELETE /api/v1/contacts/{id} - Delete contact
 */

import { ContactController } from 'server/src/lib/api/controllers/ContactController';
import { handleApiError } from 'server/src/lib/api/middleware/apiMiddleware';

const controller = new ContactController();

export async function GET(request: Request) {
  try {
    return await controller.getById()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    return await controller.update()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    return await controller.delete()(request as any);
  } catch (error) {
    return handleApiError(error);
  }
}

export const runtime = 'nodejs';