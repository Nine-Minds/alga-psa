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

export async function GET() {
  try {
    const events = await listWorkflowEventsAction();
    return NextResponse.json(events);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
