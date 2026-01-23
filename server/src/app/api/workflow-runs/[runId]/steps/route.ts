import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRunStepsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const result = await listWorkflowRunStepsAction({ runId: params.runId });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
