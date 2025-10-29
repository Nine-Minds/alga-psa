import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../lib/api/controllers/ApiAccountingExportController';

export async function GET(req: NextRequest, context: { params: { batchId: string } }) {
  const controller = new ApiAccountingExportController();
  return controller.getBatch(req, context.params);
}

export async function PATCH(req: NextRequest, context: { params: { batchId: string } }) {
  const controller = new ApiAccountingExportController();
  return controller.updateStatus(req, context.params);
}
