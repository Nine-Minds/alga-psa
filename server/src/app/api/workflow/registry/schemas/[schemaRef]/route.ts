import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { getWorkflowSchemaAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(_req: NextRequest, { params }: { params: { schemaRef: string } }) {
  try {
    const ref = decodeURIComponent(params.schemaRef);
    const result = await getWorkflowSchemaAction({ schemaRef: ref });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
