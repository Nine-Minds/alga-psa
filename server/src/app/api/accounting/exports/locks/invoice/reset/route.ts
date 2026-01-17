import { ApiAccountingExportController } from '../../../../../../../lib/api/controllers/ApiAccountingExportController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const controller = new ApiAccountingExportController();
  return controller.resetInvoiceExportLock(request as any);
}
