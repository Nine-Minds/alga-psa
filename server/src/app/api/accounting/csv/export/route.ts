import { NextRequest } from 'next/server';
import { ApiCSVAccountingController } from '../../../../../lib/api/controllers/ApiCSVAccountingController';

export async function POST(req: NextRequest) {
  const controller = new ApiCSVAccountingController();
  return controller.exportCSV(req);
}
