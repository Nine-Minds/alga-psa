import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { startWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await startWorkflowRunAction(body);
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
