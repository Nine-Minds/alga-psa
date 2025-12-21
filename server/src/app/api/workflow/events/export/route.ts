import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { exportWorkflowEventsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const result = await exportWorkflowEventsAction({
      format: searchParams.get('format') ?? undefined,
      eventName: searchParams.get('eventName') ?? undefined,
      correlationKey: searchParams.get('correlationKey') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: searchParams.get('limit') ?? '1000',
      cursor: searchParams.get('cursor') ?? '0'
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
