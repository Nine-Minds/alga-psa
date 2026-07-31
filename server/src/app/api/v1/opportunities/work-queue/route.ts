import { ApiOpportunityController } from 'server/src/lib/api/controllers/ApiOpportunityController';

const controller = new ApiOpportunityController();

export async function GET(request: Request) {
  return controller.workQueue()(request as any);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
