import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getLatestWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const workflowId = req.nextUrl.searchParams.get('workflowId');
    const eventType = req.nextUrl.searchParams.get('eventType');
    const result = await getLatestWorkflowRunAction({ workflowId, eventType: eventType || undefined });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
