import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleOpportunityManagementApi('commitment-list', request, await params);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleOpportunityManagementApi('commitment-create', request, await params);
}
