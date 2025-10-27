import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../../lib/api/controllers/ApiAccountingExportController';

export async function POST(req: NextRequest, context: { params: { batchId: string } }) {
  return ApiAccountingExportController.appendErrors(req, context);
}
