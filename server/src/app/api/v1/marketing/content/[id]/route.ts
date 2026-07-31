/**
 * GET /api/v1/marketing/content/[id] - Get marketing content
 * PUT /api/v1/marketing/content/[id] - Update marketing content
 * DELETE /api/v1/marketing/content/[id] - Delete marketing content
 */

import { ApiMarketingController } from 'server/src/lib/api/controllers/ApiMarketingController';

const controller = new ApiMarketingController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getContent()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateContent()(req);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deleteContent()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
