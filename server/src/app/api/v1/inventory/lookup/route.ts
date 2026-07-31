import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController();

export async function GET(request: Request) {
  return controller.lookup()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
