import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { replayWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const body = await req.json();
    const result = await replayWorkflowRunAction({
      runId: params.runId,
      reason: body?.reason ?? '',
      payload: body?.payload ?? {},
      source: body?.source ?? 'api'
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
