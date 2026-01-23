import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowRunDetailAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(_: Request, { params }: { params: { runId: string } }) {
  try {
    const result = await exportWorkflowRunDetailAction({ runId: params.runId });
    const body = JSON.stringify(result, null, 2);
    return new NextResponse(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename=\"workflow-run-${params.runId}.json\"`
      }
    });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
