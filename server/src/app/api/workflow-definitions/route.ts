import { NextRequest, NextResponse } from 'next/server';
import { handleWorkflowV2ApiError } from 'server/src/lib/api/workflowRuntimeV2Api';
import {
  createWorkflowDefinitionAction,
  listWorkflowDefinitionsAction
} from 'server/src/lib/actions/workflow-runtime-v2-actions';

export async function GET() {
  try {
    const definitions = await listWorkflowDefinitionsAction();
    return NextResponse.json(definitions);
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const result = await createWorkflowDefinitionAction(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return handleWorkflowV2ApiError(error);
  }
}
