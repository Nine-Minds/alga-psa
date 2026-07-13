import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleOpportunityManagementApi('forecast', request);
}
