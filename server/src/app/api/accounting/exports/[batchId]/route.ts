import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../lib/api/controllers/ApiAccountingExportController';

export async function GET(req: NextRequest, context: { params: { batchId: string } }) {
  return ApiAccountingExportController.getBatch(req, context);
}

export async function PATCH(req: NextRequest, context: { params: { batchId: string } }) {
  return ApiAccountingExportController.updateStatus(req, context);
}
