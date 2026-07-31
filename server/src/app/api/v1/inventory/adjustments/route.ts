import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController();

export async function POST(request: Request) {
  return controller.adjustStock()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
