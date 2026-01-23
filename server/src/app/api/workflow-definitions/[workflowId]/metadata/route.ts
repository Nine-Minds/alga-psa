import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { updateWorkflowDefinitionMetadataAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function PUT(req: NextRequest, { params }: { params: { workflowId: string } }) {
  try {
    const body = await req.json();
    const updated = await updateWorkflowDefinitionMetadataAction({
      workflowId: params.workflowId,
      ...body
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
