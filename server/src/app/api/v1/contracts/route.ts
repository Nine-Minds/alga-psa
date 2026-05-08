import { NextRequest } from 'next/server';
import { ApiContractLineController } from '@/lib/api/controllers/ApiContractLineController';
import { withApiKeyAuth } from '@/lib/api/middleware/apiAuthMiddleware';

export const dynamic = 'force-dynamic';

const controller = new ApiContractLineController();

export async function GET(request: NextRequest) {
  const handler = await withApiKeyAuth(controller.listContracts());
  return handler(request);
}

export async function POST(request: NextRequest) {
  const handler = await withApiKeyAuth(controller.createContract());
  return handler(request);
}