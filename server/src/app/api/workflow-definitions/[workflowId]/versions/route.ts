import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { listWorkflowDefinitionVersionsAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workflowId: string }> }) {
  try {
    const resolvedParams = await params;
    const result = await listWorkflowDefinitionVersionsAction({ workflowId: resolvedParams.workflowId });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
