import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('vendor');

export async function POST(request: Request, { params }: { params: Promise<{ vendorId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.deactivateVendor()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
