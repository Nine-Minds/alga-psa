import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import {
  getWorkflowDefinitionVersionAction,
  updateWorkflowDefinitionDraftAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workflowId: string; version: string }> }) {
  try {
    const resolvedParams = await params;
    const record = await getWorkflowDefinitionVersionAction({
      workflowId: resolvedParams.workflowId,
      version: resolvedParams.version
    });
    return NextResponse.json(record);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ workflowId: string; version: string }> }) {
  try {
    const resolvedParams = await params;
    const body = await req.json();
    const updated = await updateWorkflowDefinitionDraftAction({
      workflowId: resolvedParams.workflowId,
      definition: body?.definition ?? body
    });
    return NextResponse.json(updated);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
