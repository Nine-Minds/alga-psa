import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('vendor');

type Params = { params: Promise<{ vendorId: string; serviceId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const req = request as any;
  req.params = params;
  return controller.upsertVendorProduct()(req);
}

export async function DELETE(request: Request, { params }: Params) {
  const req = request as any;
  req.params = params;
  return controller.deleteVendorProduct()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
