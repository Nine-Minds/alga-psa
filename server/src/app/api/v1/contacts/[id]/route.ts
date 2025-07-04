/**
 * Contact by ID API Routes
 * GET /api/v1/contacts/{id} - Get contact by ID
 * PUT /api/v1/contacts/{id} - Update contact
 * DELETE /api/v1/contacts/{id} - Delete contact
 */

import { ApiContactControllerV2 } from 'server/src/lib/api/controllers/ApiContactControllerV2';

const controller = new ApiContactControllerV2();

export async function GET(request: Request) {
  return await controller.getById()(request as any);
}

export async function PUT(request: Request) {
  return await controller.update()(request as any);
}

export async function DELETE(request: Request) {
  return await controller.delete()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';