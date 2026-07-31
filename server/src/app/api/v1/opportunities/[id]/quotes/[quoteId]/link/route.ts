import { ApiOpportunityController } from 'server/src/lib/api/controllers/ApiOpportunityController';

const controller = new ApiOpportunityController();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; quoteId: string }> },
) {
  const req = request as any;
  req.params = params;
  return controller.linkQuote()(req);
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
