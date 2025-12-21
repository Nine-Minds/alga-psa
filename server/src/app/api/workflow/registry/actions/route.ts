import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRegistryActionsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET() {
  try {
    const actions = await listWorkflowRegistryActionsAction();
    return NextResponse.json(actions);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
