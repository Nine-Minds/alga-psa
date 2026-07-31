import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowDefinitionVersionsAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const resolvedParams = await params;
    const result = await runWorkflowV2RouteWithAuth(req, () => listWorkflowDefinitionVersionsAction({ workflowId: resolvedParams.workflowId }));
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
