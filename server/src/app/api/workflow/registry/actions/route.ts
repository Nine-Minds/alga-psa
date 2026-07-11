import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRegistryActionsAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const actions = await runWorkflowV2RouteWithAuth(req, () => listWorkflowRegistryActionsAction());
    return NextResponse.json(actions);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
