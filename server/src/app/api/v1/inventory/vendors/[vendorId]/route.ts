import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('vendor');

export async function GET(request: Request, { params }: { params: Promise<{ vendorId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getVendor()(req);
}

export async function PUT(request: Request, { params }: { params: Promise<{ vendorId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.updateVendor()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
