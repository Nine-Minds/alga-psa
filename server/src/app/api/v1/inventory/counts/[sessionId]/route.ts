import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('cycle_count');

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getCount()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
