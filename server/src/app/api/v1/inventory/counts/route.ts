import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('cycle_count');

export async function GET(request: Request) {
  return controller.listCounts()(request as any);
}

export async function POST(request: Request) {
  return controller.startCount()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
