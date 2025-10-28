import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../lib/api/controllers/ApiAccountingExportController';

export async function POST(req: NextRequest) {
  return ApiAccountingExportController.preview(req);
}
