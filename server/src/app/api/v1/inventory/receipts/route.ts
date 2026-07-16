import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController();

export async function POST(request: Request) {
  return controller.receiveStock()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
