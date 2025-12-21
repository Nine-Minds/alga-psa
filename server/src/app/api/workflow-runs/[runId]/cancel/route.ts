import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { cancelWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function POST(_req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const result = await cancelWorkflowRunAction({ runId: params.runId });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
