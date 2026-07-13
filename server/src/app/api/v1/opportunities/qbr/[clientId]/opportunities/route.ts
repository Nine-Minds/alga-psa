import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handleOpportunityManagementApi('qbr-create', request, await params);
}
