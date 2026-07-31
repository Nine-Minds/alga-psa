import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRegistryNodesAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const nodes = await runWorkflowV2RouteWithAuth(req, () => listWorkflowRegistryNodesAction());
    return NextResponse.json(nodes);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
