import { NextRequest } from 'next/server';
import { ApiCSVAccountingController } from '../../../../../../../../lib/api/controllers/ApiCSVAccountingController';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ importId: string }> }
) {
  const resolvedParams = await params;
  const controller = new ApiCSVAccountingController();
  return controller.rollbackImport(req, resolvedParams);
}
