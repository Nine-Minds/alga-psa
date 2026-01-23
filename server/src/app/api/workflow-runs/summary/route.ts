import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRunSummaryAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const result = await listWorkflowRunSummaryAction({
      workflowId: params.get('workflowId') ?? undefined,
      version: params.get('version') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
