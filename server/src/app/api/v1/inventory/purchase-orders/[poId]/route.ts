import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('purchase_order');

export async function GET(request: Request, { params }: { params: Promise<{ poId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.getPurchaseOrder()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
