import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController();

export async function GET(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getUnit()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
