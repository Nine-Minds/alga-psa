import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRunsAction, startWorkflowRunAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    const statusParams = params.getAll('status');
    const statusValue = statusParams.length
      ? statusParams
      : (params.get('status') ?? '').split(',').map((value) => value.trim()).filter(Boolean);

    const result = await listWorkflowRunsAction({
      status: statusValue.length ? statusValue : undefined,
      workflowId: params.get('workflowId') ?? undefined,
      version: params.get('version') ?? undefined,
      runId: params.get('runId') ?? undefined,
      search: params.get('search') ?? undefined,
      from: params.get('from') ?? undefined,
      to: params.get('to') ?? undefined,
      limit: params.get('limit') ?? undefined,
      cursor: params.get('cursor') ?? undefined,
      sort: params.get('sort') ?? undefined
    });

    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await startWorkflowRunAction(body);
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
