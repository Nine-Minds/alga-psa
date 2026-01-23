import { NextRequest } from 'next/server';
import { ApiCSVAccountingController } from '../../../../../../../lib/api/controllers/ApiCSVAccountingController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const controller = new ApiCSVAccountingController();
  return controller.getTemplate(req);
}
