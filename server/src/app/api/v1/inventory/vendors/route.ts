import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('vendor');

export async function GET(request: Request) {
  return controller.listVendors()(request as any);
}

export async function POST(request: Request) {
  return controller.createVendor()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
