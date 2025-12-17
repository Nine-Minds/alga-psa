import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../lib/api/controllers/ApiAccountingExportController';

export async function GET(req: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  const controller = new ApiAccountingExportController();
  return controller.getBatch(req, params);
}

export async function PATCH(req: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  const controller = new ApiAccountingExportController();
  return controller.updateStatus(req, params);
}
