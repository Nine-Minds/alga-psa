import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getWorkflowSchemaAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ schemaRef: string }> }) {
  try {
    const resolvedParams = await params;
    const ref = decodeURIComponent(resolvedParams.schemaRef);
    const result = await runWorkflowV2RouteWithAuth(req, () => getWorkflowSchemaAction({ schemaRef: ref }));
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
