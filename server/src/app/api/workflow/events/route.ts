import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import {
  listWorkflowEventsAction,
  submitWorkflowEventAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await submitWorkflowEventAction(body);
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const events = await listWorkflowEventsAction({
      eventName: searchParams.get('eventName') ?? undefined,
      correlationKey: searchParams.get('correlationKey') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      from: searchParams.get('from') ?? undefined,
      to: searchParams.get('to') ?? undefined,
      limit: searchParams.get('limit') ?? undefined,
      cursor: searchParams.get('cursor') ?? undefined
    });
    return NextResponse.json(events);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
