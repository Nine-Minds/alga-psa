import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getWorkflowAuthoringGuideAction } from '@alga-psa/workflows/actions';

export async function GET(req: NextRequest) {
  try {
    const result = await runWorkflowV2RouteWithAuth(req, () => getWorkflowAuthoringGuideAction());
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
