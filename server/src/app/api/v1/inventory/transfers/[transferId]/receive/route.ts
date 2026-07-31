import { ApiInventoryController } from 'server/src/lib/api/controllers/ApiInventoryController';

const controller = new ApiInventoryController('stock_transfer');

export async function POST(request: Request, { params }: { params: Promise<{ transferId: string }> }) {
  const req = request as any;
  req.params = params;
  return controller.receiveTransfer()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
