import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../lib/api/controllers/ApiAccountingExportController';

export async function POST(req: NextRequest) {
  const controller = new ApiAccountingExportController();
  return controller.preview(req);
}
