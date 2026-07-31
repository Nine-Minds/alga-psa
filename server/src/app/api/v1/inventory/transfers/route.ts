import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('stock_transfer');

export async function GET(request: Request) {
  return controller.listTransfers()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
