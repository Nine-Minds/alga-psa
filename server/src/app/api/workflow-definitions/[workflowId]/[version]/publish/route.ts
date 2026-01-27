import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import { publishWorkflowDefinitionAction } from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function POST(req: NextRequest, { params }: { params: Promise<{ workflowId: string; version: string }> }) {
  try {
    const resolvedParams = await params;
    const body = await req.json().catch(() => ({}));
    const result = await publishWorkflowDefinitionAction({
      workflowId: resolvedParams.workflowId,
      version: resolvedParams.version,
      definition: body?.definition
    });
    return NextResponse.json(result);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
