import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listEventCatalogOptionsV2Action } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = searchParams.get('limit');
    const result = await runWorkflowV2RouteWithAuth(req, () => listEventCatalogOptionsV2Action({
      search: searchParams.get('search') ?? undefined,
      source: searchParams.get('source') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      ...(limitParam ? { limit: Number(limitParam) } : {}),
    }));
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
