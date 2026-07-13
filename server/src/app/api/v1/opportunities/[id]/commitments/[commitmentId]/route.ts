import { handleOpportunityManagementApi } from '@enterprise/lib/opportunities/apiHandlers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = { params: Promise<{ id: string; commitmentId: string }> };

export async function PUT(request: Request, { params }: RouteContext): Promise<Response> {
  return handleOpportunityManagementApi('commitment-update', request, await params);
}

export async function DELETE(request: Request, { params }: RouteContext): Promise<Response> {
  return handleOpportunityManagementApi('commitment-delete', request, await params);
}
