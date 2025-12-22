import { NextRequest } from 'next/server';
import { ApiCSVAccountingController } from '../../../../../../../lib/api/controllers/ApiCSVAccountingController';

export async function GET(req: NextRequest) {
  const controller = new ApiCSVAccountingController();
  return controller.getImportHistory(req);
}
