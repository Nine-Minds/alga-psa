import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('purchase_order');

export async function GET(request: Request) {
  return controller.listPurchaseOrders()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
