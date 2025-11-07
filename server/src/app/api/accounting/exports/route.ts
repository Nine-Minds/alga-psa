import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../lib/api/controllers/ApiAccountingExportController';

export async function GET(req: NextRequest) {
  const controller = new ApiAccountingExportController();
  return controller.listBatches(req);
}

export async function POST(req: NextRequest) {
  const controller = new ApiAccountingExportController();
  return controller.createBatch(req);
}
