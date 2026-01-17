import { NextRequest } from 'next/server';
import { ApiAccountingExportController } from '../../../../../../lib/api/controllers/ApiAccountingExportController';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, context: { params: Promise<{ batchId: string }> }) {
  const params = await context.params;
  const controller = new ApiAccountingExportController();
  return controller.execute(req, params);
}
