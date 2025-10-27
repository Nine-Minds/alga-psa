import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../lib/api/controllers/ApiAccountingExportController';

export async function GET(req: NextRequest) {
  return ApiAccountingExportController.listBatches(req);
}

export async function POST(req: NextRequest) {
  return ApiAccountingExportController.createBatch(req);
}
