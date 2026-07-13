import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ clientId: string }> },
): Promise<Response> {
  return handleOpportunityManagementApi('qbr-pack', request, await params);
}
