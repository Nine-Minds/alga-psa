/**
 * Quote Revisions API Route
 * GET /api/v1/quotes/[id]/revisions - List all versions of a quote
 * POST /api/v1/quotes/[id]/revisions - Create new revision
 */

import { ApiQuoteController } from 'server/src/lib/api/controllers/ApiQuoteController';

const controller = new ApiQuoteController();

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.listVersions()(req);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.createRevision()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
