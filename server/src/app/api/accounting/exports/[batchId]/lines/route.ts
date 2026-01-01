import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../../lib/api/controllers/ApiAccountingExportController';

export async function POST(req: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  const controller = new ApiAccountingExportController();
  return controller.appendLines(req, params);
}
