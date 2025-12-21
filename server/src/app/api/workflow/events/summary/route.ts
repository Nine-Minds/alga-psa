import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowEventSummaryAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await listWorkflowEventSummaryAction({
      eventName: searchParams.get('eventName') ?? undefined,
      correlationKey: searchParams.get('correlationKey') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
