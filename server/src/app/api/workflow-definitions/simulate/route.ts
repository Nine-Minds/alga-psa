import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError, runWorkflowV2RouteWithAuth } from 'server/src/lib/api/workflowRuntimeV2Api';
import { simulateWorkflowDefinitionDraftAction } from '@alga-psa/workflows/actions';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await runWorkflowV2RouteWithAuth(req, () => simulateWorkflowDefinitionDraftAction(body));
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
