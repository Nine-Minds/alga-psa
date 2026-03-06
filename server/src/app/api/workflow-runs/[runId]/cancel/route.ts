import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { cancelWorkflowRunAction } from '@alga-psa/workflows/actions';

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  try {
    const body = await req.json();
    const result = await cancelWorkflowRunAction({
      runId: params.runId,
      reason: body?.reason ?? '',
      source: body?.source ?? 'api'
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
