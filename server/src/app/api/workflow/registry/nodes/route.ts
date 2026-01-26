import { NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowRegistryNodesAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET() {
  try {
    const nodes = await listWorkflowRegistryNodesAction();
    return NextResponse.json(nodes);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
