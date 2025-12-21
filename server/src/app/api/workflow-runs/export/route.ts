import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowRunsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await exportWorkflowRunsAction({
      status: searchParams.getAll('status') ?? undefined,
      workflowId: searchParams.get('workflowId') ?? undefined,
      version: searchParams.get('version') ?? undefined,
      runId: searchParams.get('runId') ?? undefined,
      search: searchParams.get('search') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: searchParams.get('limit') ?? '1000',
      cursor: searchParams.get('cursor') ?? '0',
      sort: (searchParams.get('sort') as any) ?? 'started_at:desc'
    });

    return new NextResponse(result.body, {
      headers: {
        'Content-Type': result.contentType,
        'Content-Disposition': `attachment; filename=\"${result.filename}\"`
      }
    });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
