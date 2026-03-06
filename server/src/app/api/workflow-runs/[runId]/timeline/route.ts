import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRunTimelineEventsAction } from '@alga-psa/workflows/actions';

export async function GET(_req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const result = await listWorkflowRunTimelineEventsAction({ runId: params.runId });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
