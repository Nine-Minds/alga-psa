import { NextRequest } from 'next/server';
import { ApiCSVAccountingController } from '../../../../../../lib/api/controllers/ApiCSVAccountingController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const controller = new ApiCSVAccountingController();
  return controller.importTax(req);
}
